import Foundation
import UIKit
import WebKit

/// Delegate callbacks for the chrome the doctor taps (Cancel / Done / Stop). Dismissal and event
/// emission stay owned by the plugin so `close()` and Cancel go through one code path.
protocol ConnectBrowserViewControllerDelegate: AnyObject {
    func connectBrowserDidRequestClose(_ vc: ConnectBrowserViewController)
    func connectBrowserDidTapDone(_ vc: ConnectBrowserViewController)
    func connectBrowserDidTapStop(_ vc: ConnectBrowserViewController)
}

/// Full-screen modal chrome around the shared WKWebView: a safe-area aware header (title/subtitle,
/// Cancel, and a Done button in login mode), an agent-mode banner with a Stop button, and a clear
/// overlay that swallows the doctor's touches while the agent is driving.
final class ConnectBrowserViewController: UIViewController {
    weak var delegate: ConnectBrowserViewControllerDelegate?

    let webView: WKWebView
    private(set) var mode: String = "login"
    private(set) var allowedOrigins: Set<String>

    private let hostTitle: String
    private let titleLabel = UILabel()
    private let subtitleLabel = UILabel()
    private let cancelButton = UIButton(type: .system)
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
        modalPresentationStyle = .fullScreen
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    // A locked or dimmed phone stops the web view laying out and can drop the hospital session: keep
    // the screen awake for as long as the browser is presented.
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
        applyMode(mode, banner: nil, origins: nil)
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
        cancelButton.translatesAutoresizingMaskIntoConstraints = false

        doneButton.setTitle("Done, I'm signed in", for: .normal)
        doneButton.titleLabel?.numberOfLines = 1
        doneButton.titleLabel?.adjustsFontSizeToFitWidth = true
        doneButton.addTarget(self, action: #selector(doneTapped), for: .touchUpInside)
        doneButton.translatesAutoresizingMaskIntoConstraints = false

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

        header.addSubview(cancelButton)
        header.addSubview(doneButton)
        header.addSubview(titleStack)

        NSLayoutConstraint.activate([
            header.heightAnchor.constraint(equalToConstant: 48),
            cancelButton.leadingAnchor.constraint(equalTo: header.leadingAnchor, constant: 12),
            cancelButton.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            doneButton.trailingAnchor.constraint(equalTo: header.trailingAnchor, constant: -12),
            doneButton.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            doneButton.leadingAnchor.constraint(greaterThanOrEqualTo: titleStack.trailingAnchor, constant: 8),
            titleStack.centerXAnchor.constraint(equalTo: header.centerXAnchor),
            titleStack.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            titleStack.leadingAnchor.constraint(greaterThanOrEqualTo: cancelButton.trailingAnchor, constant: 8)
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
    /// `agent`: banner + Stop button, touches swallowed, native origin allowlist enforced elsewhere.
    func applyMode(_ newMode: String, banner: String?, origins: [String]?) {
        mode = newMode
        if let origins = origins {
            allowedOrigins = Set(origins)
        }

        // login: doctor drives, Done button, no banner. agent: banner + Stop, touch overlay ON, origins
        // enforced. guide: the agent asks the doctor to show it something: banner with the question, Done
        // button, NO touch overlay (the doctor must be able to tap), origins enforced.
        let isAgent = mode == "agent"
        let isGuide = mode == "guide"
        subtitleLabel.text = (isAgent || isGuide) ? "" : "Sign in yourself. StewardMD never sees your password."
        doneButton.isHidden = isAgent
        doneButton.setTitle(isGuide ? "Done" : "Done, I'm signed in", for: .normal)
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

    @objc private func doneTapped() {
        delegate?.connectBrowserDidTapDone(self)
    }

    @objc private func stopTapped() {
        delegate?.connectBrowserDidTapStop(self)
    }
}
