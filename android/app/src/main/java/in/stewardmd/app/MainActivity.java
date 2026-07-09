package in.stewardmd.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.community.speechrecognition.SpeechRecognition;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SafePushNotificationsPlugin.class);
        registerPlugin(SafeFirebaseAuthenticationPlugin.class);
        registerPlugin(SpeechRecognition.class);
        registerPlugin(AppOrientationPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
