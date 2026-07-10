package com.getcapacitor.community.speechrecognition;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.locks.ReentrantLock;
import org.json.JSONArray;

@CapacitorPlugin(
    permissions = { @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = SpeechRecognition.SPEECH_RECOGNITION) }
)
public class SpeechRecognition extends Plugin implements Constants {

    public static final String TAG = "SpeechRecognition";
    private static final String LISTENING_EVENT = "listeningState";
    static final String SPEECH_RECOGNITION = "speechRecognition";

    private Receiver languageReceiver;
    private SpeechRecognizer speechRecognizer;

    private final ReentrantLock lock = new ReentrantLock();
    private boolean listening = false;

    private JSONArray previousPartialResults = new JSONArray();

    // ---- Continuous dictation (MaiK Scribe) --------------------------------
    // Android's SpeechRecognizer is a single-utterance engine: it fires
    // onEndOfSpeech/onResults/onError the moment it detects a pause and would
    // otherwise end the session after ~1s. For streaming (partialResults=true)
    // we keep the session alive by re-arming the recognizer on each endpoint,
    // accumulating text across utterances, and only finalizing when the JS
    // side explicitly calls stop().
    private boolean streaming = false; // true while a continuous dictation is active
    private boolean userStopped = false; // set by stop(): suppress further auto-restarts
    private Intent activeIntent = null; // recognizer config, reused on every restart
    private PluginCall streamCall = null; // the resolved start() call (events flow to it)
    private final StringBuilder accumulated = new StringBuilder(); // finalized text so far
    private String lastEmitted = ""; // dedupe repeated partial emissions
    private SpeechRecognitionListener currentListener = null; // stale-callback guard

    @Override
    public void load() {
        super.load();
        bridge
            .getWebView()
            .post(() -> {
                speechRecognizer = SpeechRecognizer.createSpeechRecognizer(bridge.getActivity());
                SpeechRecognitionListener listener = new SpeechRecognitionListener();
                speechRecognizer.setRecognitionListener(listener);
                Logger.info(getLogTag(), "Instantiated SpeechRecognizer in load()");
            });
    }

    @PluginMethod
    public void available(PluginCall call) {
        Logger.info(getLogTag(), "Called for available(): " + isSpeechRecognitionAvailable());
        boolean val = isSpeechRecognitionAvailable();
        JSObject result = new JSObject();
        result.put("available", val);
        call.resolve(result);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (!isSpeechRecognitionAvailable()) {
            call.unavailable(NOT_AVAILABLE);
            return;
        }

        if (getPermissionState(SPEECH_RECOGNITION) != PermissionState.GRANTED) {
            call.reject(MISSING_PERMISSION);
            return;
        }

        String language = call.getString("language", Locale.getDefault().toString());
        int maxResults = call.getInt("maxResults", MAX_RESULTS);
        String prompt = call.getString("prompt", null);
        boolean partialResults = call.getBoolean("partialResults", false);
        boolean popup = call.getBoolean("popup", false);
        beginListening(language, maxResults, prompt, partialResults, popup, call);
    }

    @PluginMethod
    public void stop(final PluginCall call) {
        try {
            stopListening();
        } catch (Exception ex) {
            call.reject(ex.getLocalizedMessage());
        }
    }

    @PluginMethod
    public void getSupportedLanguages(PluginCall call) {
        if (languageReceiver == null) {
            languageReceiver = new Receiver(call);
        }

        List<String> supportedLanguages = languageReceiver.getSupportedLanguages();
        if (supportedLanguages != null) {
            JSONArray languages = new JSONArray(supportedLanguages);
            call.resolve(new JSObject().put("languages", languages));
            return;
        }

        Intent detailsIntent = new Intent(RecognizerIntent.ACTION_GET_LANGUAGE_DETAILS);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            detailsIntent.setPackage("com.google.android.googlequicksearchbox");
        }
        bridge.getActivity().sendOrderedBroadcast(detailsIntent, null, languageReceiver, null, Activity.RESULT_OK, null, null);
    }

    @PluginMethod
    public void isListening(PluginCall call) {
        call.resolve(new JSObject().put("listening", SpeechRecognition.this.listening));
    }

    @ActivityCallback
    private void listeningResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }

        int resultCode = result.getResultCode();
        if (resultCode == Activity.RESULT_OK) {
            try {
                ArrayList<String> matchesList = result.getData().getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
                JSObject resultObj = new JSObject();
                resultObj.put("matches", new JSArray(matchesList));
                call.resolve(resultObj);
            } catch (Exception ex) {
                call.reject(ex.getMessage());
            }
        } else {
            call.reject(Integer.toString(resultCode));
        }

        SpeechRecognition.this.lock.lock();
        SpeechRecognition.this.listening(false);
        SpeechRecognition.this.lock.unlock();
    }

    private boolean isSpeechRecognitionAvailable() {
        return SpeechRecognizer.isRecognitionAvailable(bridge.getContext());
    }

    private void listening(boolean value) {
        this.listening = value;
    }

    private void beginListening(
        String language,
        int maxResults,
        String prompt,
        final boolean partialResults,
        boolean showPopup,
        PluginCall call
    ) {
        Logger.info(getLogTag(), "Beginning to listen for audible speech");

        final Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, language);
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, maxResults);
        intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, bridge.getActivity().getPackageName());
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, partialResults);
        intent.putExtra("android.speech.extra.DICTATION_MODE", partialResults);
        // Added to prevent early timeout
        intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, 5000L);
        intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 2000L);
        intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 2000L);

        if (prompt != null) {
            intent.putExtra(RecognizerIntent.EXTRA_PROMPT, prompt);
        }

        if (showPopup) {
            startActivityForResult(call, intent, "listeningResult");
        } else {
            // Start (or, in streaming mode, keep alive) a recognizer session.
            this.streaming = partialResults;
            this.userStopped = false;
            this.activeIntent = intent;
            this.streamCall = call;
            this.accumulated.setLength(0);
            this.lastEmitted = "";
            this.previousPartialResults = new JSONArray();
            startRecognizer(call, partialResults);
            if (partialResults) {
                // Streaming: results arrive via the partialResults/listeningState
                // events, so resolve start() immediately (see native-bridge.js).
                call.resolve();
            }
        }
    }

    // (Re)creates the recognizer and begins listening with activeIntent. Called
    // on the initial start and on every auto-restart between utterances.
    private void startRecognizer(final PluginCall call, final boolean partialResults) {
        bridge
            .getWebView()
            .post(() -> {
                try {
                    SpeechRecognition.this.lock.lock();

                    if (speechRecognizer != null) {
                        speechRecognizer.cancel();
                        speechRecognizer.destroy();
                        speechRecognizer = null;
                    }

                    speechRecognizer = SpeechRecognizer.createSpeechRecognizer(bridge.getActivity());
                    SpeechRecognitionListener listener = new SpeechRecognitionListener();
                    listener.setCall(call);
                    listener.setPartialResults(partialResults);
                    // Mark this listener active; callbacks from any prior (now
                    // destroyed) recognizer are ignored via isActive().
                    SpeechRecognition.this.currentListener = listener;
                    speechRecognizer.setRecognitionListener(listener);
                    speechRecognizer.startListening(SpeechRecognition.this.activeIntent);
                    SpeechRecognition.this.listening(true);
                } catch (Exception ex) {
                    Logger.error(getLogTag(), "startRecognizer failed: " + ex.getMessage(), ex);
                    if (!SpeechRecognition.this.streaming && call != null) {
                        call.reject(ex.getMessage());
                    }
                } finally {
                    SpeechRecognition.this.lock.unlock();
                }
            });
    }

    // Re-arm the recognizer after an utterance endpoint so continuous dictation
    // survives natural pauses. No-op once the user has stopped.
    private void scheduleRestart() {
        scheduleRestart(60);
    }

    // delayMs lets error-driven restarts back off (let the service settle / avoid a
    // RECOGNIZER_BUSY spin) while seamless end-of-utterance restarts stay snappy.
    private void scheduleRestart(long delayMs) {
        if (userStopped || activeIntent == null) return;
        bridge
            .getWebView()
            .postDelayed(
                () -> {
                    if (userStopped) return;
                    startRecognizer(streamCall, true);
                },
                delayMs
            );
    }

    private void emitStopped() {
        JSObject ret = new JSObject();
        ret.put("status", "stopped");
        notifyListeners(LISTENING_EVENT, ret);
    }

    // Emit the FULL running transcript (finalized utterances + the live partial)
    // as matches[0]; native-bridge.js keeps this as `last` for onPartial/onFinal.
    private void emitTranscript(String current) {
        String full = accumulated.toString();
        if (current != null && !current.isEmpty()) {
            full = full.isEmpty() ? current : full + " " + current;
        }
        if (full.isEmpty() || full.equals(lastEmitted)) return;
        lastEmitted = full;
        ArrayList<String> one = new ArrayList<>();
        one.add(full);
        JSObject ret = new JSObject();
        ret.put("matches", new JSArray(one));
        notifyListeners("partialResults", ret);
    }

    private void stopListening() {
        bridge
            .getWebView()
            .post(() -> {
                try {
                    SpeechRecognition.this.lock.lock();
                    SpeechRecognition.this.userStopped = true;
                    if (SpeechRecognition.this.listening && speechRecognizer != null) {
                        speechRecognizer.stopListening();
                        SpeechRecognition.this.listening(false);
                    }
                    if (SpeechRecognition.this.streaming) {
                        // Finalize the dictation for the JS side. A trailing
                        // onResults (if any) will refresh `last` before the JS
                        // 450ms finish timer fires; duplicate "stopped" is safe.
                        SpeechRecognition.this.emitStopped();
                    }
                } catch (Exception ex) {
                    Logger.error(getLogTag(), "stopListening failed: " + ex.getMessage(), ex);
                } finally {
                    SpeechRecognition.this.lock.unlock();
                }
            });
    }

    private class SpeechRecognitionListener implements RecognitionListener {

        private PluginCall call;
        private boolean partialResults;

        public void setCall(PluginCall call) {
            this.call = call;
        }

        public void setPartialResults(boolean partialResults) {
            this.partialResults = partialResults;
        }

        // Ignore callbacks from a recognizer we've already replaced during a
        // restart — only the newest listener drives state.
        private boolean isActive() {
            return SpeechRecognition.this.currentListener == this;
        }

        @Override
        public void onReadyForSpeech(Bundle params) {}

        @Override
        public void onBeginningOfSpeech() {
            if (!isActive()) return;
            // Notify listeners that recording has started (ignored by JS; harmless
            // to re-emit on each restarted utterance).
            JSObject ret = new JSObject();
            ret.put("status", "started");
            SpeechRecognition.this.notifyListeners(LISTENING_EVENT, ret);
        }

        @Override
        public void onRmsChanged(float rmsdB) {}

        @Override
        public void onBufferReceived(byte[] buffer) {}

        @Override
        public void onEndOfSpeech() {
            if (!isActive()) return;
            // Streaming: do NOT end the session here — the recognizer endpoints on
            // every pause. onResults/onError decides whether to re-arm or finalize.
            if (SpeechRecognition.this.streaming) return;

            SpeechRecognition.this.listening(false);
            JSObject ret = new JSObject();
            ret.put("status", "stopped");
            SpeechRecognition.this.notifyListeners(LISTENING_EVENT, ret);
        }

        @Override
        public void onError(int error) {
            if (!isActive()) return;
            String errorMssg = getErrorText(error);
            Logger.error("Speech Recognition Error: " + errorMssg + " (Code: " + error + ")", null);

            if (SpeechRecognition.this.streaming) {
                if (SpeechRecognition.this.userStopped) {
                    // User asked to stop — finalize with whatever was accumulated.
                    SpeechRecognition.this.listening(false);
                    SpeechRecognition.this.emitStopped();
                    return;
                }
                // The dictation must keep running until the user taps stop. Only a
                // genuinely fatal condition ends it; everything else (silence,
                // busy, server-disconnected, network, client, audio glitches) is
                // transient — re-arm and carry on.
                boolean fatal =
                    error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS ||
                    error == SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED ||
                    error == SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE;
                if (fatal) {
                    SpeechRecognition.this.listening(false);
                    SpeechRecognition.this.emitStopped();
                    return;
                }
                boolean silence = error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT;
                // Silence = a natural pause: restart snappily. Real errors: back off a
                // little so the recognition service can settle before we retry.
                SpeechRecognition.this.scheduleRestart(silence ? 60 : 300);
                return;
            }

            SpeechRecognition.this.stopListening();
            if (this.call != null) {
                call.reject(errorMssg);
            }
        }

        @Override
        public void onResults(Bundle results) {
            if (!isActive()) return;
            ArrayList<String> matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);

            if (SpeechRecognition.this.streaming) {
                String finalText = (matches != null && !matches.isEmpty()) ? matches.get(0) : "";
                if (finalText != null && !finalText.isEmpty()) {
                    if (SpeechRecognition.this.accumulated.length() > 0) {
                        SpeechRecognition.this.accumulated.append(" ");
                    }
                    SpeechRecognition.this.accumulated.append(finalText);
                }
                SpeechRecognition.this.emitTranscript("");
                if (SpeechRecognition.this.userStopped) {
                    SpeechRecognition.this.emitStopped();
                } else {
                    SpeechRecognition.this.scheduleRestart();
                }
                return;
            }

            try {
                JSArray jsArray = new JSArray(matches);
                if (this.call != null) {
                    this.call.resolve(new JSObject().put("status", "success").put("matches", jsArray));
                }
            } catch (Exception ex) {
                if (this.call != null) {
                    this.call.resolve(new JSObject().put("status", "error").put("message", ex.getMessage()));
                }
            }
        }

        @Override
        public void onPartialResults(Bundle partialResults) {
            if (!isActive()) return;
            ArrayList<String> matches = partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            if (matches == null || matches.isEmpty()) return;

            if (SpeechRecognition.this.streaming) {
                // Emit finalized text + this segment's live partial as one transcript.
                SpeechRecognition.this.emitTranscript(matches.get(0));
                return;
            }

            JSArray matchesJSON = new JSArray(matches);
            try {
                if (!previousPartialResults.equals(matchesJSON)) {
                    previousPartialResults = matchesJSON;
                    JSObject ret = new JSObject();
                    ret.put("matches", previousPartialResults);
                    notifyListeners("partialResults", ret);
                }
            } catch (Exception ex) {}
        }

        @Override
        public void onEvent(int eventType, Bundle params) {}
    }

    private String getErrorText(int errorCode) {
        String message;
        switch (errorCode) {
            case SpeechRecognizer.ERROR_AUDIO:
                message = "Audio recording error";
                break;
            case SpeechRecognizer.ERROR_CLIENT:
                message = "Client side error";
                break;
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                message = "Insufficient permissions";
                break;
            case SpeechRecognizer.ERROR_NETWORK:
                message = "Network error";
                break;
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                message = "Network timeout";
                break;
            case SpeechRecognizer.ERROR_NO_MATCH:
                message = "No match";
                break;
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:
                message = "RecognitionService busy";
                break;
            case SpeechRecognizer.ERROR_SERVER:
                message = "error from server";
                break;
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                message = "No speech input";
                break;
            default:
                message = "Didn't understand, please try again.";
                break;
        }
        return message;
    }
}
