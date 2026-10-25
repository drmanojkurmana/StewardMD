import Foundation
import Capacitor
import CoreBluetooth

/// Kardia SyncProbe BLE (iOS). Display = GATT peripheral, Probe = central.
/// Custom 128-bit service. Foreground only, one central, no state restoration.
/// Exposed to JS as Capacitor.Plugins.KardiaBle. Frames arrive whole; the JS
/// adapter refuses frames larger than maxPayload (negotiated MTU minus 3).
@objc(KardiaBlePlugin)
public class KardiaBlePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "KardiaBlePlugin"
    public let jsName = "KardiaBle"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getCapabilities", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "host", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "join", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "send", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise)
    ]

    static let serviceUUID = CBUUID(string: "A91E0001-9D3C-4F5A-B2C4-1A2B3C4D5E6F")
    static let infoUUID = CBUUID(string: "A91E0002-9D3C-4F5A-B2C4-1A2B3C4D5E6F")
    static let downUUID = CBUUID(string: "A91E0003-9D3C-4F5A-B2C4-1A2B3C4D5E6F")
    static let upUUID = CBUUID(string: "A91E0004-9D3C-4F5A-B2C4-1A2B3C4D5E6F")
    static let protocolVersion: UInt8 = 1

    private var centralManager: CBCentralManager?
    private var peripheralManager: CBPeripheralManager?
    private var role: String = ""
    private var expectedHash: Data?
    private var sessionIdHex: String = ""
    private var displayPub: Data = Data()
    private var infoValue: Data = Data()

    private var hostCentral: CBCentral?
    private var hostReady = false
    private var infoChar: CBMutableCharacteristic?
    private var downChar: CBMutableCharacteristic?
    private var upChar: CBMutableCharacteristic?

    private var probePeripheral: CBPeripheral?
    private var probeDown: CBCharacteristic?
    private var probeUp: CBCharacteristic?
    private var probeInfo: CBCharacteristic?
    private var pendingHost: CAPPluginCall?
    private var pendingJoin: CAPPluginCall?
    private var serviceAdded = false

    private func ensureManagers() {
        if centralManager == nil { centralManager = CBCentralManager(delegate: self, queue: .main) }
        if peripheralManager == nil { peripheralManager = CBPeripheralManager(delegate: self, queue: .main) }
    }

    private func maxPayload() -> Int {
        if role == "probe", let p = probePeripheral {
            return max(20, p.maximumWriteValueLength(for: .withoutResponse))
        }
        return 182
    }

    private func capsDict() -> [String: Any] {
        ensureManagers()
        let state = centralManager?.state ?? .unknown
        let on = state == .poweredOn
        let auth = CBManager.authorization
        let available = on && auth != .denied && auth != .restricted
        var reason = ""
        if auth == .denied || auth == .restricted { reason = "Bluetooth permission is denied. Allow Bluetooth for StewardMD in Settings." }
        else if state == .poweredOff { reason = "Bluetooth is off. Turn Bluetooth on and try again." }
        else if state == .unsupported { reason = "This device does not support Bluetooth Low Energy." }
        else if state == .unauthorized { reason = "Bluetooth permission is denied. Allow Bluetooth for StewardMD in Settings." }
        else if !on { reason = "Bluetooth is not ready yet." }
        return ["available": available, "reason": reason, "canAdvertise": available,
                "canScan": available, "needsInternet": false, "maxPayload": maxPayload(),
                "platform": "ios", "bluetoothState": state.rawValue,
                "authorization": auth.rawValue]
    }

    @objc func getCapabilities(_ call: CAPPluginCall) { call.resolve(capsDict()) }

    @objc func requestPermissions(_ call: CAPPluginCall) {
        ensureManagers()
        // Creating the managers triggers the system prompt when not determined.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
            guard let self = self else { return }
            let auth = CBManager.authorization
            call.resolve(["granted": auth == .allowedAlways || auth == .notDetermined,
                          "authorization": auth.rawValue])
        }
    }

    static func buildInfo(sessionIdHex: String, displayPub: Data) -> Data {
        var d = Data()
        d.append(protocolVersion)
        d.append(UInt8(min(displayPub.count, 255)))
        d.append(displayPub.prefix(255))
        var sid = Data(repeating: 0, count: 16)
        let bytes = hexToData(sessionIdHex)
        if bytes.count == 16 { sid = bytes }
        d.append(sid)
        return d
    }

    static func hexToData(_ hex: String) -> Data {
        var s = hex
        if s.hasPrefix("0x") { s = String(s.dropFirst(2)) }
        var out = Data(); var idx = s.startIndex
        while idx < s.endIndex {
            let nxt = s.index(idx, offsetBy: 2, limitedBy: s.endIndex) ?? s.endIndex
            if nxt > idx, let b = UInt8(s[idx..<nxt], radix: 16) { out.append(b) }
            idx = nxt
        }
        return out
    }

    static func dataToHex(_ d: Data) -> String { d.map { String(format: "%02x", $0) }.joined() }

    @objc func host(_ call: CAPPluginCall) {
        ensureManagers()
        teardown(silent: true)
        role = "display"
        sessionIdHex = call.getString("sessionId") ?? ""
        expectedHash = Self.hexToData(call.getString("codeHashHex") ?? "")
        if expectedHash?.count != 4 { expectedHash = nil }
        displayPub = Data(base64Encoded: call.getString("displayPub") ?? "") ?? Data()
        infoValue = Self.buildInfo(sessionIdHex: sessionIdHex, displayPub: displayPub)
        pendingHost = call
        startHostingIfReady()
    }

    private func startHostingIfReady() {
        guard role == "display", !serviceAdded, let pm = peripheralManager, pm.state == .poweredOn else { return }
        serviceAdded = true
        let info = CBMutableCharacteristic(type: Self.infoUUID, properties: [.read], value: nil, permissions: [.readable])
        info.value = infoValue
        let down = CBMutableCharacteristic(type: Self.downUUID, properties: [.notify, .writeWithoutResponse], value: nil, permissions: [.readable, .writeable])
        let up = CBMutableCharacteristic(type: Self.upUUID, properties: [.notify, .writeWithoutResponse], value: nil, permissions: [.readable, .writeable])
        infoChar = info; downChar = down; upChar = up
        let svc = CBMutableService(type: Self.serviceUUID, primary: true)
        svc.characteristics = [info, down, up]
        pm.removeAllServices()
        pm.add(svc)
    }

    @objc func join(_ call: CAPPluginCall) {
        ensureManagers()
        teardown(silent: true)
        role = "probe"
        sessionIdHex = call.getString("sessionId") ?? ""
        expectedHash = Self.hexToData(call.getString("codeHashHex") ?? "")
        if expectedHash?.count != 4 { expectedHash = nil }
        pendingJoin = call
        startScanIfReady()
    }

    private func startScanIfReady() {
        guard role == "probe", let cm = centralManager, cm.state == .poweredOn else { return }
        cm.scanForPeripherals(withServices: [Self.serviceUUID], options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
        pendingJoin?.resolve(["started": true])
        pendingJoin = nil
    }

    @objc func send(_ call: CAPPluginCall) {
        guard let b64 = call.getString("data"), let data = Data(base64Encoded: b64) else {
            call.resolve(["sent": false]); return
        }
        if data.count > maxPayload() { call.resolve(["sent": false]); return }
        if role == "display" {
            guard let pm = peripheralManager, let down = downChar, let c = hostCentral, hostReady else {
                call.resolve(["sent": false]); return
            }
            let ok = pm.updateValue(data, for: down, onSubscribedCentrals: [c])
            call.resolve(["sent": ok])
        } else if role == "probe" {
            guard let p = probePeripheral, let up = probeUp else { call.resolve(["sent": false]); return }
            p.writeValue(data, for: up, type: .withoutResponse)
            call.resolve(["sent": true])
        } else { call.resolve(["sent": false]) }
    }

    @objc func close(_ call: CAPPluginCall) {
        teardown(silent: false)
        call.resolve(["closed": true])
    }

    private func teardown(silent: Bool) {
        centralManager?.stopScan()
        if let p = probePeripheral { centralManager?.cancelPeripheralConnection(p) }
        peripheralManager?.stopAdvertising()
        peripheralManager?.removeAllServices()
        serviceAdded = false
        probePeripheral = nil; probeDown = nil; probeUp = nil; probeInfo = nil
        hostCentral = nil; hostReady = false
        if !silent { role = "" }
        pendingHost = nil; pendingJoin = nil
    }

    private func emitBytes(_ data: Data) {
        notifyListeners("bytesReceived", data: ["data": data.base64EncodedString()])
    }
    private func emitLost(_ reason: String) { notifyListeners("peerLost", data: ["reason": reason]) }
    private func emitError(_ msg: String) { notifyListeners("bleError", data: ["message": msg]) }

    private func matchesHash(adv: [String: Any]) -> Bool {
        guard let want = expectedHash, want.count == 4 else { return true }
        if let dict = adv[CBAdvertisementDataServiceDataKey] as? [CBUUID: Data],
           let d = dict[Self.serviceUUID], d.prefix(4) == want.prefix(4) { return true }
        let name = (adv[CBAdvertisementDataLocalNameKey] as? String) ?? ""
        if name == "KS-" + Self.dataToHex(want).uppercased() { return true }
        // If neither form is present in this advertisement, do not match on hash.
        let hasServiceData = (adv[CBAdvertisementDataServiceDataKey] as? [CBUUID: Data])?[Self.serviceUUID] != nil
        if !hasServiceData && name.isEmpty { return false }
        return false
    }
}

extension KardiaBlePlugin: CBCentralManagerDelegate, CBPeripheralDelegate {
    public func centralManagerDidUpdateState(_ central: CBCentralManager) {
        notifyListeners("stateChanged", data: capsDict())
        if central.state == .poweredOn {
            if role == "display" { startHostingIfReady() }
            if role == "probe" { startScanIfReady() }
        } else if central.state == .poweredOff {
            emitLost("Bluetooth was turned off.")
        }
        if pendingHost != nil && central.state != .poweredOn && central.state != .unknown {
            pendingHost?.reject("Bluetooth is not available.")
            pendingHost = nil
        }
        if pendingJoin != nil && central.state != .poweredOn && central.state != .unknown {
            pendingJoin?.reject("Bluetooth is not available.")
            pendingJoin = nil
        }
    }

    public func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
                               advertisementData: [String: Any], rssi RSSI: NSNumber) {
        guard role == "probe", probePeripheral == nil else { return }
        guard matchesHash(adv: advertisementData) else { return }
        probePeripheral = peripheral
        peripheral.delegate = self
        central.stopScan()
        central.connect(peripheral, options: nil)
    }

    public func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        peripheral.discoverServices([Self.serviceUUID])
    }

    public func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        emitError(error?.localizedDescription ?? "Could not connect to the display.")
        emitLost("Connection failed.")
        probePeripheral = nil
    }

    public func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        if peripheral === probePeripheral {
            probePeripheral = nil; probeDown = nil; probeUp = nil; probeInfo = nil
            emitLost(error?.localizedDescription ?? "The display disconnected.")
        }
    }

    public func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard let svc = peripheral.services?.first(where: { $0.uuid == Self.serviceUUID }) else {
            if let e = error { emitError(e.localizedDescription) }
            return
        }
        peripheral.discoverCharacteristics([Self.infoUUID, Self.downUUID, Self.upUUID], for: svc)
    }

    public func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        for ch in service.characteristics ?? [] {
            if ch.uuid == Self.downUUID { probeDown = ch; peripheral.setNotifyValue(true, for: ch) }
            if ch.uuid == Self.upUUID { probeUp = ch; peripheral.setNotifyValue(true, for: ch) }
            if ch.uuid == Self.infoUUID { probeInfo = ch; peripheral.readValue(for: ch) }
        }
    }

    public func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard let v = characteristic.value else { return }
        if characteristic.uuid == Self.infoUUID {
            var pub = Data(); var ver = 0; var sid = ""
            if v.count >= 2 {
                ver = Int(v[0]); let n = Int(v[1])
                if v.count >= 2 + n { pub = v.subdata(in: 2..<(2 + n)) }
                if v.count >= 2 + n + 16 { sid = Self.dataToHex(v.subdata(in: (2 + n)..<(2 + n + 16))) }
            }
            if !sessionIdHex.isEmpty && !sid.isEmpty && sid.lowercased() != sessionIdHex.lowercased() {
                emitError("This display is for a different pairing session.")
                centralManager?.cancelPeripheralConnection(peripheral)
                return
            }
            notifyListeners("peerConnected", data: ["role": "probe", "displayPub": pub.base64EncodedString(),
                            "protocolVersion": ver, "sessionId": sid, "maxPayload": maxPayload()])
        } else {
            emitBytes(v)
        }
    }

    public func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
        if let e = error { emitError(e.localizedDescription) }
    }
}

extension KardiaBlePlugin: CBPeripheralManagerDelegate {
    public func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
        if peripheral.state == .poweredOn, role == "display" { startHostingIfReady() }
    }

    public func peripheralManager(_ peripheral: CBPeripheralManager, didAdd service: CBService, error: Error?) {
        if let e = error { serviceAdded = false; pendingHost?.reject(e.localizedDescription); pendingHost = nil; emitError(e.localizedDescription); return }
        var adv: [String: Any] = [CBAdvertisementDataServiceUUIDsKey: [Self.serviceUUID]]
        if let h = expectedHash, h.count == 4 {
            adv[CBAdvertisementDataLocalNameKey] = "KS-" + Self.dataToHex(h).uppercased()
        }
        peripheral.startAdvertising(adv)
        pendingHost?.resolve(["started": true])
        pendingHost = nil
    }

    public func peripheralManagerDidStartAdvertising(_ peripheral: CBPeripheralManager, error: Error?) {
        if let e = error { emitError(e.localizedDescription) }
    }

    public func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral, didSubscribeTo characteristic: CBCharacteristic) {
        if hostCentral != nil && hostCentral !== central { return }
        hostCentral = central
        if characteristic.uuid == Self.downUUID {
            hostReady = true
            notifyListeners("peerConnected", data: ["role": "display", "maxPayload": maxPayload()])
        }
    }

    public func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral, didUnsubscribeFrom characteristic: CBCharacteristic) {
        if central === hostCentral && characteristic.uuid == Self.downUUID {
            hostReady = false; hostCentral = nil
            emitLost("The probe disconnected.")
        }
    }

    public func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveRead request: CBATTRequest) {
        if request.characteristic.uuid == Self.infoUUID {
            request.value = infoValue
            peripheral.respond(to: request, withResult: .success)
        } else { peripheral.respond(to: request, withResult: .attributeNotFound) }
    }

    public func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]) {
        for req in requests {
            if hostCentral != nil && req.central !== hostCentral { continue }
            if let v = req.value { emitBytes(v) }
            if req.responseNeeded { peripheral.respond(to: req, withResult: .success) }
        }
    }

    public func peripheralManagerIsReady(toUpdateSubscribers peripheral: CBPeripheralManager) {}
}
