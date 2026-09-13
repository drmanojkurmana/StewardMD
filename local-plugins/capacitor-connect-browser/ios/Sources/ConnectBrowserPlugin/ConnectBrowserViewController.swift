import Foundation
import UIKit
import WebKit

/// Delegate callbacks for the chrome the doctor taps (Cancel / Done / Stop / Not in my EMR).
/// Dismissal and event emission stay owned by the plugin so `close()` and Cancel go through one
/// code path. Back is handled locally (it just walks WKWebView history) — no delegate needed.
protocol ConnectBrowserViewControllerDelegate: AnyObject {
    func connectBrowserDidRequestClose(_ vc: ConnectBrowserViewController)
    func connectBrowserDidTapDone(_ vc: ConnectBrowserViewController)
    func connectBrowserDidTapStop(_ vc: ConnectBrowserViewController)
    func connectBrowserDidTapSkip(_ vc: ConnectBrowserViewController)
}

/// Chrome around the shared WKWebView: a safe-area aware header (title/subtitle, Cancel, Back,
/// "Not in my EMR" in guide mode, and Done), an agent/guide-mode banner with a Stop button, and a
/// clear overlay that swallows the doctor's touches while the agent is driving (agent mode only).
/// The plugin controls presentation (full screen vs. the top 52% in compact agent mode) by sizing
/// `view` directly — this controller only lays out its own content within whatever frame it is given.
final class ConnectBrowserViewController: UIViewController {
    weak var delegate: ConnectBrowserViewControllerDelegate?

    let webView: WKWebView
    private(set) var mode: String = "login"
    private(set) var compact: Bool = false
    private(set) var allowedOrigins: Set<String>

    private let hostTitle: String
    private let titleLabel = UILabel()
    private let subtitleLabel = UILabel()
    private let cancelButton = UIButton(type: .system)
    private let backButton = UIButton(type: .system)
    private let skipButton = UIButton(type: .system)
    private let doneButton = UIButton(type: .system)
    private let bannerView = UIView()
    private let bannerLabel = UILabel()
    private let stopButton = UIButton(type: .system)
    private let touchBlockerView = UIView()
    private var bannerHeightConstraint: NSLayoutConstraint!

    init(webView: WKWebView, origins: [String], title: String) {
        self.webView = webView
        self.allowedOrigins = Set(origins)
        self.hostTitle = title
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    // A locked or dimmed phone stops the web view laying out and can drop the hospital session: keep
    // the screen awake for as long as the browser is on screen.
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        UIApplication.shared.isIdleTimerDisabled = true
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        UIApplication.shared.isIdleTimerDisabled = false
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        buildHeader()
        buildBanner()
        buildContent()
        applyMode(mode, banner: nil, origins: nil, compact: false)
    }

    // MARK: - Layout

    private func buildHeader() {
        let header = UIView()
        header.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(header)
        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            header.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            header.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])

        cancelButton.setTitle("Cancel", for: .normal)
        cancelButton.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)

        backButton.setTitle("Back", for: .normal)
        backButton.addTarget(self, action: #selector(backTapped), for: .touchUpInside)

        // guide-only escape hatch: the agent's expected screen isn't there, let the doctor say so
        // instead of hunting for it. Visible only in guide mode (see applyMode).
        skipButton.setTitle("Not in my EMR", for: .normal)
        skipButton.titleLabel?.numberOfLines = 1
        skipButton.titleLabel?.adjustsFontSizeToFitWidth = true
        skipButton.addTarget(self, action: #selector(skipTapped), for: .touchUpInside)

        doneButton.setTitle("Done, I'm signed in", for: .normal)
        doneButton.titleLabel?.numberOfLines = 1
        doneButton.titleLabel?.adjustsFontSizeToFitWidth = true
        doneButton.addTarget(self, action: #selector(doneTapped), for: .touchUpInside)

        titleLabel.text = hostTitle
        titleLabel.font = .systemFont(ofSize: 15, weight: .semibold)
        titleLabel.textAlignment = .center
        titleLabel.lineBreakMode = .byTruncatingMiddle

        subtitleLabel.font = .systemFont(ofSize: 12, weight: .regular)
        subtitleLabel.textColor = .secondaryLabel
        subtitleLabel.textAlignment = .center
        subtitleLabel.numberOfLines = 1

        let titleStack = UIStackView(arrangedSubviews: [titleLabel, subtitleLabel])
        titleStack.axis = .vertical
        titleStack.alignment = .center
        titleStack.spacing = 2
        titleStack.translatesAutoresizingMaskIntoConstraints = false

        // Arranged in stacks so a hidden button (Back in agent mode, "Not in my EMR" outside guide
        // mode) collapses its spacing instead of leaving a gap — mirrors the Android header's
        // View.GONE behaviour in its LinearLayout.
        let leadingStack = UIStackView(arrangedSubviews: [cancelButton, backButton])
        leadingStack.axis = .horizontal
        leadingStack.spacing = 8
        leadingStack.translatesAutoresizingMaskIntoConstraints = false

        let trailingStack = UIStackView(arrangedSubviews: [skipButton, doneButton])
        trailingStack.axis = .horizontal
        trailingStack.spacing = 8
        trailingStack.translatesAutoresizingMaskIntoConstraints = false

        header.addSubview(leadingStack)
        header.addSubview(trailingStack)
        header.addSubview(titleStack)

        NSLayoutConstraint.activate([
            header.heightAnchor.constraint(equalToConstant: 48),
            leadingStack.leadingAnchor.constraint(equalTo: header.leadingAnchor, constant: 12),
            leadingStack.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            trailingStack.trailingAnchor.constraint(equalTo: header.trailingAnchor, constant: -12),
            trailingStack.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            trailingStack.leadingAnchor.constraint(greaterThanOrEqualTo: titleStack.trailingAnchor, constant: 8),
            titleStack.centerXAnchor.constraint(equalTo: header.centerXAnchor),
            titleStack.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            titleStack.leadingAnchor.constraint(greaterThanOrEqualTo: leadingStack.trailingAnchor, constant: 8)
        ])

        self.headerRef = header
    }

    // Anchor for the banner below the header; stashed instead of a stored property to keep
    // buildHeader/buildBanner independent of call order.
    private var headerRef: UIView!

    private func buildBanner() {
        bannerView.translatesAutoresizingMaskIntoConstraints = false
        bannerView.backgroundColor = .systemOrange
        bannerView.clipsToBounds = true
        view.addSubview(bannerView)

        bannerHeightConstraint = bannerView.heightAnchor.constraint(equalToConstant: 0)
        NSLayoutConstraint.activate([
            bannerView.topAnchor.constraint(equalTo: headerRef.bottomAnchor),
            bannerView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            bannerView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            bannerHeightConstraint
        ])

        bannerLabel.font = .systemFont(ofSize: 13, weight: .medium)
        bannerLabel.textColor = .white
        bannerLabel.numberOfLines = 2
        bannerLabel.translatesAutoresizingMaskIntoConstraints = false

        stopButton.setTitle("Stop", for: .normal)
        stopButton.setTitleColor(.white, for: .normal)
        stopButton.titleLabel?.font = .systemFont(ofSize: 14, weight: .bold)
        stopButton.addTarget(self, action: #selector(stopTapped), for: .touchUpInside)
        stopButton.translatesAutoresizingMaskIntoConstraints = false

        bannerView.addSubview(bannerLabel)
        bannerView.addSubview(stopButton)
        NSLayoutConstraint.activate([
            bannerLabel.leadingAnchor.constraint(equalTo: bannerView.leadingAnchor, constant: 12),
            bannerLabel.topAnchor.constraint(greaterThanOrEqualTo: bannerView.topAnchor, constant: 6),
            bannerLabel.bottomAnchor.constraint(lessThanOrEqualTo: bannerView.bottomAnchor, constant: -6),
            bannerLabel.centerYAnchor.constraint(equalTo: bannerView.centerYAnchor),
            stopButton.trailingAnchor.constraint(equalTo: bannerView.trailingAnchor, constant: -12),
            stopButton.centerYAnchor.constraint(equalTo: bannerView.centerYAnchor),
            stopButton.leadingAnchor.constraint(greaterThanOrEqualTo: bannerLabel.trailingAnchor, constant: 8)
        ])
    }

    private func buildContent() {
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: bannerView.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])

        touchBlockerView.translatesAutoresizingMaskIntoConstraints = false
        touchBlockerView.backgroundColor = .clear
        touchBlockerView.isUserInteractionEnabled = false
        view.addSubview(touchBlockerView)
        NSLayoutConstraint.activate([
            touchBlockerView.topAnchor.constraint(equalTo: webView.topAnchor),
            touchBlockerView.leadingAnchor.constraint(equalTo: webView.leadingAnchor),
            touchBlockerView.trailingAnchor.constraint(equalTo: webView.trailingAnchor),
            touchBlockerView.bottomAnchor.constraint(equalTo: webView.bottomAnchor)
        ])
    }

    // MARK: - Mode

    /// `login`: interactive web view, header shows the sign-in subtitle + Done button.
    /// `agent`: banner + Stop button, touches swallowed, Back hidden, native origin allowlist
    /// enforced elsewhere; `compact` (plugin-applied) shrinks the presented frame to the top 52%.
    /// `guide`: banner with the question, Done + "Not in my EMR", no touch overlay (the doctor must
    /// be able to tap), origins enforced.
    func applyMode(_ newMode: String, banner: String?, origins: [String]?, compact: Bool) {
        mode = newMode
        self.compact = compact
        if let origins = origins {
            allowedOrigins = Set(origins)
        }

        let isAgent = mode == "agent"
        let isGuide = mode == "guide"
        subtitleLabel.text = (isAgent || isGuide) ? "" : "Sign in yourself. StewardMD never sees your password."
        doneButton.isHidden = isAgent
        doneButton.setTitle(isGuide ? "Done" : "Done, I'm signed in", for: .normal)
        backButton.isHidden = isAgent
        skipButton.isHidden = !isGuide
        bannerLabel.text = banner ?? "StewardMD is reading \(hostTitle) on your behalf. Tap Stop to end."
        bannerHeightConstraint.constant = (isAgent || isGuide) ? 44 : 0
        bannerView.isHidden = !(isAgent || isGuide)
        touchBlockerView.isUserInteractionEnabled = isAgent
        UIView.animate(withDuration: 0.2) { self.view.layoutIfNeeded() }
    }

    // MARK: - Actions

    @objc private func cancelTapped() {
        delegate?.connectBrowserDidRequestClose(self)
    }

    @objc private func backTapped() {
        if webView.canGoBack {
            webView.goBack()
        }
    }

    @objc private func skipTapped() {
        delegate?.connectBrowserDidTapSkip(self)
    }

    @objc private func doneTapped() {
        delegate?.connectBrowserDidTapDone(self)
    }

    @objc private func stopTapped() {
        delegate?.connectBrowserDidTapStop(self)
    }
}
