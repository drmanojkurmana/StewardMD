import Foundation
import Capacitor
import StoreKit

/**
 * Minimal StoreKit 2 in-app-purchase bridge for StewardMD Pro (iOS 15+).
 *
 * The purchase happens here; the resulting transaction id is handed to JS, which POSTs it to
 * /api/billing/iap/verify. The SERVER (functions/_iap.js) re-validates the transaction with the
 * App Store Server API and grants the Pro entitlement (the `pro` claim). A purchase is NEVER trusted
 * from the client alone. iOS-only for now; Android Play Billing is a later addition.
 *
 * JS: Capacitor.Plugins.Iap
 *   .getProducts({ productIds: [String] })   -> { products: [{ id, displayName, description, price, priceAmount }] }
 *   .purchase({ productId })                  -> { transactionId, originalTransactionId, productId } | { cancelled } | { pending }
 *   .restore()                                -> { entitlements: [{ productId, transactionId, originalTransactionId }] }
 *   .currentEntitlements()                    -> { entitlements: [...] }
 */
@objc(IapPlugin)
public class IapPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "IapPlugin"
    public let jsName = "Iap"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getProducts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "currentEntitlements", returnType: CAPPluginReturnPromise)
    ]

    @objc func getProducts(_ call: CAPPluginCall) {
        guard let ids = call.getArray("productIds", String.self), !ids.isEmpty else {
            call.reject("productIds required"); return
        }
        if #available(iOS 15.0, *) {
            Task {
                do {
                    let products = try await Product.products(for: ids)
                    let arr: [[String: Any]] = products.map { p in
                        return [
                            "id": p.id,
                            "displayName": p.displayName,
                            "description": p.description,
                            "price": p.displayPrice,
                            "priceAmount": (p.price as NSDecimalNumber).doubleValue
                        ]
                    }
                    call.resolve(["products": arr])
                } catch {
                    call.reject("getProducts failed: \(error.localizedDescription)")
                }
            }
        } else {
            call.reject("StoreKit 2 requires iOS 15 or later")
        }
    }

    @objc func purchase(_ call: CAPPluginCall) {
        guard let pid = call.getString("productId") else { call.reject("productId required"); return }
        if #available(iOS 15.0, *) {
            Task {
                do {
                    let products = try await Product.products(for: [pid])
                    guard let product = products.first else { call.reject("product not found: \(pid)"); return }
                    let result = try await product.purchase()
                    switch result {
                    case .success(let verification):
                        switch verification {
                        case .verified(let transaction):
                            let payload: [String: Any] = [
                                "transactionId": String(transaction.id),
                                "originalTransactionId": String(transaction.originalID),
                                "productId": transaction.productID
                            ]
                            // Finish only after handing the id back; the server grants the entitlement.
                            await transaction.finish()
                            call.resolve(payload)
                        case .unverified(_, let err):
                            call.reject("purchase unverified: \(err.localizedDescription)")
                        }
                    case .userCancelled:
                        call.resolve(["cancelled": true])
                    case .pending:
                        call.resolve(["pending": true])
                    @unknown default:
                        call.reject("unknown purchase result")
                    }
                } catch {
                    call.reject("purchase failed: \(error.localizedDescription)")
                }
            }
        } else {
            call.reject("StoreKit 2 requires iOS 15 or later")
        }
    }

    @objc func restore(_ call: CAPPluginCall) {
        if #available(iOS 15.0, *) {
            Task {
                do { try await AppStore.sync() } catch { /* sync is best-effort */ }
                await self.resolveEntitlements(call)
            }
        } else {
            call.reject("StoreKit 2 requires iOS 15 or later")
        }
    }

    @objc func currentEntitlements(_ call: CAPPluginCall) {
        if #available(iOS 15.0, *) {
            Task { await self.resolveEntitlements(call) }
        } else {
            call.reject("StoreKit 2 requires iOS 15 or later")
        }
    }

    @available(iOS 15.0, *)
    private func resolveEntitlements(_ call: CAPPluginCall) async {
        var active: [[String: Any]] = []
        for await result in Transaction.currentEntitlements {
            if case .verified(let t) = result {
                active.append([
                    "productId": t.productID,
                    "transactionId": String(t.id),
                    "originalTransactionId": String(t.originalID)
                ])
            }
        }
        call.resolve(["entitlements": active])
    }
}
