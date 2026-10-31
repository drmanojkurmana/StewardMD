import Foundation
import Capacitor
import UIKit
import SpotifyiOS

/**
 * Spotify App Remote bridge for the PrepNucleus music player (iOS). Exposed to JS as
 * `Capacitor.Plugins.SpotifyRemote`.
 *
 * Why this exists: the Spotify Web API player endpoints sometimes report NO device while this
 * phone is audibly playing, and iOS suspends a paused Spotify within ~30 s so no Web API command
 * can wake it. App Remote talks to the Spotify app on THIS device directly. It only works while
 * Spotify is running; bringing Spotify up is `wake()` (authorizeAndPlayURI), which the web layer
 * calls ONLY from an explicit "Wake Spotify" tap — this plugin never switches apps on its own.
 *
 * The Web API access token (PKCE, owned by prep-sound-spotify.js) is handed to `connect` and
 * kept in memory here only — it is never logged and never written to disk. The App Remote auth
 * return (`stewardmd://spotify-callback?access_token=…`, produced by `wake`) is consumed from
 * Capacitor's open-URL notification; a URL carrying a PKCE `code` is left untouched for JS.
 *
 * Lifecycle: the connection is dropped when the app enters the background (App Remote cannot
 * hold it there) and re-established on foreground when a token was given earlier.
 */
@objc(SpotifyRemotePlugin)
public class SpotifyRemotePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SpotifyRemotePlugin"
    public let jsName = "SpotifyRemote"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "connect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disconnect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "next", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "previous", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seek", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setShuffle", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setRepeat", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "wake", returnType: CAPPluginReturnPromise)
    ]

    private static let clientID = "9545526c500040058279facbdcdba9ee"
    private static let redirectURL = URL(string: "stewardmd://spotify-callback")!

    private var appRemote: SPTAppRemote?
    private var storedAccessToken: String?
    private var connectCall: CAPPluginCall?
    private var connectTimeout: DispatchWorkItem?
    private var lastState: [String: Any]?
    private var lastImageTrackURI: String?
    private var lastImageDataUrl: String?
    private var wasConnectedBeforeBackground = false

    override public func load() {
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(onOpenURL(_:)),
                       name: .capacitorOpenURL, object: nil)
        nc.addObserver(self, selector: #selector(appDidEnterBackground),
                       name: UIApplication.didEnterBackgroundNotification, object: nil)
        nc.addObserver(self, selector: #selector(appWillEnterForeground),
                       name: UIApplication.willEnterForegroundNotification, object: nil)
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    // MARK: - Availability

    private func spotifyInstalled() -> Bool {
        guard let url = URL(string: "spotify:") else { return false }
        return UIApplication.shared.canOpenURL(url)
    }

    @objc func isAvailable(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            let installed = self?.spotifyInstalled() ?? false
            call.resolve(["available": installed, "spotifyInstalled": installed])
        }
    }

    // MARK: - Connection

    private func makeRemote(accessToken: String?) -> SPTAppRemote {
        let config = SPTConfiguration(clientID: Self.clientID, redirectURL: Self.redirectURL)
        let params = SPTAppRemoteConnectionParams(
            accessToken: accessToken,
            defaultImageSize: CGSize(width: 300, height: 300),
            imageFormat: .JPEG)
        let remote = SPTAppRemote(configuration: config, connectionParameters: params, logLevel: .error)
        remote.delegate = self
        return remote
    }

    private func settleConnect(connected: Bool, error: String?) {
        connectTimeout?.cancel()
        connectTimeout = nil
        guard let call = connectCall else { return }
        connectCall = nil
        if connected {
            call.resolve(["connected": true])
        } else {
            call.reject(error ?? "Spotify did not connect.", "spotify_not_connected")
        }
    }

    @objc func connect(_ call: CAPPluginCall) {
        let token = call.getString("accessToken") ?? storedAccessToken
        guard let token, !token.isEmpty else {
            call.reject("No access token given.", "spotify_no_token")
            return
        }
        storedAccessToken = token
        DispatchQueue.main.async { [weak self] in
            guard let self else { call.reject("Plugin gone.", "spotify_unavailable"); return }
            if self.appRemote?.isConnected == true {
                call.resolve(["connected": true])
                return
            }
            if !self.spotifyInstalled() {
                call.reject("Spotify is not installed on this device.", "spotify_not_installed")
                return
            }
            // A fresh instance per attempt: a failed SPTAppRemote is not reliably reusable.
            self.appRemote?.delegate = nil
            let remote = self.makeRemote(accessToken: token)
            self.appRemote = remote
            self.connectCall = call
            let timeout = DispatchWorkItem { [weak self] in
                self?.settleConnect(connected: false,
                                     error: "Spotify is not running. Open Spotify once, then try again.")
                self?.notifyListeners("connection",
                                      data: ["connected": false, "error": "spotify_not_running"])
            }
            self.connectTimeout = timeout
            DispatchQueue.main.asyncAfter(deadline: .now() + 12, execute: timeout)
            remote.connect()
        }
    }

    @objc func disconnect(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.teardown(clearToken: true)
            call.resolve(["connected": false])
        }
    }

    private func teardown(clearToken: Bool) {
        connectTimeout?.cancel()
        connectTimeout = nil
        if let call = connectCall {
            connectCall = nil
            call.reject("Disconnected.", "spotify_disconnected")
        }
        appRemote?.playerAPI?.unsubscribeToPlayerState(nil)
        appRemote?.playerAPI?.delegate = nil
        appRemote?.disconnect()
        appRemote?.delegate = nil
        appRemote = nil
        if clearToken { storedAccessToken = nil }
        lastState = nil
        notifyListeners("connection", data: ["connected": false])
    }

    // MARK: - State

    private func repeatName(_ mode: SPTAppRemotePlaybackOptionsRepeatMode) -> String {
        switch mode {
        case .track: return "track"
        case .context: return "context"
        default: return "off"
        }
    }

    private func stateDict(_ state: SPTAppRemotePlayerState) -> [String: Any] {
        let track = state.track
        var dict: [String: Any] = [
            "connected": true,
            "trackUri": track?.uri ?? "",
            "title": track?.name ?? "",
            "artist": track?.artist?.name ?? "",
            "album": track?.album?.name ?? "",
            "durationMs": Int(track?.duration ?? 0),
            "positionMs": state.playbackPosition,
            "isPaused": state.isPaused,
            "shuffle": state.playbackOptions.isShuffling,
            "repeat": repeatName(state.playbackOptions.repeatMode)
        ]
        if let uri = track?.uri, uri == lastImageTrackURI, let dataUrl = lastImageDataUrl {
            dict["imageDataUrl"] = dataUrl
        }
        return dict
    }

    private func emitState(_ state: SPTAppRemotePlayerState) {
        let dict = stateDict(state)
        lastState = dict
        notifyListeners("playerState", data: dict)
        fetchImageIfNeeded(for: state)
    }

    private func fetchImageIfNeeded(for state: SPTAppRemotePlayerState) {
        guard let track = state.track, let uri = track.uri, uri != lastImageTrackURI,
              let imageAPI = appRemote?.imageAPI else { return }
        lastImageTrackURI = uri
        imageAPI.fetchImage(for: track, with: CGSize(width: 300, height: 300)) { [weak self] result, _ in
            guard let image = result as? UIImage,
                  let data = image.jpegData(compressionQuality: 0.8) else { return }
            DispatchQueue.main.async { [weak self] in
                guard let self, self.lastImageTrackURI == uri else { return }
                self.lastImageDataUrl = "data:image/jpeg;base64," + data.base64EncodedString()
                // Re-emit the unchanged state, now carrying the artwork for this track.
                if var dict = self.lastState {
                    dict["imageDataUrl"] = self.lastImageDataUrl ?? ""
                    self.lastState = dict
                    self.notifyListeners("playerState", data: dict)
                }
            }
        }
    }

    @objc func getState(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.appRemote?.isConnected == true,
                  let playerAPI = self.appRemote?.playerAPI else {
                call.resolve(["connected": false, "trackUri": "", "title": "", "artist": "",
                              "album": "", "durationMs": 0, "positionMs": 0, "isPaused": true,
                              "shuffle": false, "repeat": "off"])
                return
            }
            playerAPI.getPlayerState { [weak self] result, error in
                if let state = result as? SPTAppRemotePlayerState {
                    let dict = self?.stateDict(state) ?? [:]
                    self?.lastState = dict
                    call.resolve(dict)
                } else {
                    call.reject(error?.localizedDescription ?? "No player state.", "spotify_no_state")
                }
            }
        }
    }

    // MARK: - Transport

    private func withPlayerAPI(_ call: CAPPluginCall,
                                 _ body: @escaping (SPTAppRemotePlayerAPI) -> Void) {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.appRemote?.isConnected == true,
                  let playerAPI = self.appRemote?.playerAPI else {
                call.reject("Spotify is not connected.", "spotify_not_connected")
                return
            }
            body(playerAPI)
        }
    }

    private func settle(_ call: CAPPluginCall) -> SPTAppRemoteCallback {
        return { _, error in
            if let error {
                call.reject(error.localizedDescription, "spotify_command_failed")
            } else {
                call.resolve(["ok": true])
            }
        }
    }

    @objc func play(_ call: CAPPluginCall) {
        let uri = call.getString("uri") ?? ""
        let positionMs = call.getInt("positionMs")
        guard !uri.isEmpty else { call.reject("No track or playlist URI given.", "spotify_no_uri"); return }
        withPlayerAPI(call) { [weak self] playerAPI in
            playerAPI.play(uri) { _, error in
                if let error {
                    call.reject(error.localizedDescription, "spotify_command_failed")
                    return
                }
                guard let positionMs, positionMs > 0 else { call.resolve(["ok": true]); return }
                // Start position (resume where it paused): seek once playback has been accepted.
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in
                    self?.appRemote?.playerAPI?.seek(toPosition: positionMs, callback: nil)
                }
                call.resolve(["ok": true])
            }
        }
    }

    @objc func resume(_ call: CAPPluginCall) {
        let done = settle(call)
        withPlayerAPI(call) { playerAPI in playerAPI.resume(done) }
    }

    @objc func pause(_ call: CAPPluginCall) {
        let done = settle(call)
        withPlayerAPI(call) { playerAPI in playerAPI.pause(done) }
    }

    @objc func next(_ call: CAPPluginCall) {
        let done = settle(call)
        withPlayerAPI(call) { playerAPI in playerAPI.skipToNext(done) }
    }

    @objc func previous(_ call: CAPPluginCall) {
        let done = settle(call)
        withPlayerAPI(call) { playerAPI in playerAPI.skipToPrevious(done) }
    }

    @objc func seek(_ call: CAPPluginCall) {
        let positionMs = call.getInt("positionMs") ?? 0
        let done = settle(call)
        withPlayerAPI(call) { playerAPI in
            playerAPI.seek(toPosition: max(0, positionMs), callback: done)
        }
    }

    @objc func setShuffle(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? false
        let done = settle(call)
        withPlayerAPI(call) { playerAPI in
            playerAPI.setShuffle(on, callback: done)
        }
    }

    @objc func setRepeat(_ call: CAPPluginCall) {
        let mode: SPTAppRemotePlaybackOptionsRepeatMode
        switch call.getString("mode") ?? "off" {
        case "track": mode = .track
        case "context": mode = .context
        default: mode = .off
        }
        let done = settle(call)
        withPlayerAPI(call) { playerAPI in
            playerAPI.setRepeatMode(mode, callback: done)
        }
    }

    // MARK: - Wake (explicit tap only)

    @objc func wake(_ call: CAPPluginCall) {
        let uri = call.getString("uri") ?? ""
        DispatchQueue.main.async { [weak self] in
            guard let self else { call.reject("Plugin gone.", "spotify_unavailable"); return }
            if !self.spotifyInstalled() {
                call.reject("Spotify is not installed on this device.", "spotify_not_installed")
                return
            }
            // authorizeAndPlayURI parses its return through this same instance family, so keep
            // one around even before any connect() succeeded.
            if self.appRemote == nil {
                self.appRemote = self.makeRemote(accessToken: self.storedAccessToken)
            }
            // Spotify flicks open, starts the URI (blank resumes the last song), then returns to
            // us through stewardmd://spotify-callback — handled in onOpenURL.
            self.appRemote?.authorizeAndPlayURI(uri) { started in
                if started {
                    call.resolve(["opened": true])
                } else {
                    call.reject("Spotify could not be opened.", "spotify_not_installed")
                }
            }
        }
    }

    // MARK: - App Remote auth return URL

    @objc private func onOpenURL(_ notification: Notification) {
        let url: URL?
        if let dict = notification.object as? [String: Any] {
            url = dict["url"] as? URL
        } else {
            url = notification.object as? URL
        }
        guard let url, url.scheme == "stewardmd",
              url.absoluteString.contains("spotify-callback") else { return }
        // The PKCE Web API return (?code=&state=) belongs to prep-sound-spotify.js. Never touch it.
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        if components?.queryItems?.contains(where: { $0.name == "code" }) == true { return }
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            if self.appRemote == nil {
                self.appRemote = self.makeRemote(accessToken: self.storedAccessToken)
            }
            guard let params = self.appRemote?.authorizationParameters(from: url) else { return }
            if let token = params[SPTAppRemoteAccessTokenKey], !token.isEmpty {
                // Never logged. Connect with the token Spotify just issued for App Remote.
                self.storedAccessToken = token
                let remote = self.makeRemote(accessToken: token)
                self.appRemote?.delegate = nil
                self.appRemote = remote
                remote.connect()
            } else {
                let message = params[SPTAppRemoteErrorDescriptionKey]
                    ?? params[SPTAppRemoteErrorKey] ?? "Spotify sign-in was cancelled."
                self.notifyListeners("connection", data: ["connected": false, "error": message])
            }
        }
    }

    // MARK: - Lifecycle

    @objc private func appDidEnterBackground() {
        // App Remote cannot hold its connection in the background; drop it and remember to
        // restore it on foreground when a token was given.
        wasConnectedBeforeBackground = appRemote?.isConnected == true
        guard wasConnectedBeforeBackground else { return }
        appRemote?.playerAPI?.unsubscribeToPlayerState(nil)
        appRemote?.playerAPI?.delegate = nil
        appRemote?.disconnect()
        appRemote?.delegate = nil
        appRemote = nil
        notifyListeners("connection", data: ["connected": false])
    }

    @objc private func appWillEnterForeground() {
        guard wasConnectedBeforeBackground, let token = storedAccessToken, !token.isEmpty else { return }
        wasConnectedBeforeBackground = false
        let remote = makeRemote(accessToken: token)
        appRemote = remote
        remote.connect()
    }
}

// MARK: - SPTAppRemoteDelegate

extension SpotifyRemotePlugin: SPTAppRemoteDelegate {
    public func appRemoteDidEstablishConnection(_ appRemote: SPTAppRemote) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            appRemote.playerAPI?.delegate = self
            appRemote.playerAPI?.subscribeToPlayerState { [weak self] result, _ in
                if let state = result as? SPTAppRemotePlayerState {
                    DispatchQueue.main.async { self?.emitState(state) }
                }
            }
            self.settleConnect(connected: true, error: nil)
            self.notifyListeners("connection", data: ["connected": true])
        }
    }

    public func appRemote(_ appRemote: SPTAppRemote, didFailConnectionAttemptWithError error: Error?) {
        DispatchQueue.main.async { [weak self] in
            self?.settleConnect(connected: false,
                                 error: "Spotify is not running. Open Spotify once, then try again.")
            self?.notifyListeners("connection", data: ["connected": false, "error": "spotify_not_running"])
        }
    }

    public func appRemote(_ appRemote: SPTAppRemote, didDisconnectWithError error: Error?) {
        DispatchQueue.main.async { [weak self] in
            self?.notifyListeners("connection", data: ["connected": false])
        }
    }
}

// MARK: - SPTAppRemotePlayerStateDelegate

extension SpotifyRemotePlugin: SPTAppRemotePlayerStateDelegate {
    public func playerStateDidChange(_ playerState: SPTAppRemotePlayerState) {
        DispatchQueue.main.async { [weak self] in self?.emitState(playerState) }
    }
}
