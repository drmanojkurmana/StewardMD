// StewardMD Wear OS client — additive module. Independent of :app (Capacitor). Kotlin + Compose for
// Wear OS. Deps are intentionally LEAN for the scaffold: only what MainActivity + the Robolectric
// smoke test need. Later tasks add their own: Ktor (Task 2 networking), Firebase Auth+Firestore +
// play-services-wearable (Task 3/4 auth bridge + ICU reads), FCM (Task 12 push), Horologist (screens).
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "in.stewardmd.wear"
    compileSdk = 36

    defaultConfig {
        applicationId = "in.stewardmd.wear"
        minSdk = 26            // Wear OS baseline
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    buildFeatures { compose = true }

    testOptions {
        unitTests.isIncludeAndroidResources = true   // Robolectric needs resources
    }

    // The Kotlin source lives under src/main/kotlin (brief layout).
    sourceSets["main"].java.srcDirs("src/main/kotlin")
    sourceSets["test"].java.srcDirs("src/test/kotlin")
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)

    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")

    // Compose for Wear OS (not part of the Compose BOM — pin explicitly).
    implementation("androidx.wear.compose:compose-material:1.4.1")
    implementation("androidx.wear.compose:compose-foundation:1.4.1")

    testImplementation(composeBom)
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.14.1")
    testImplementation("androidx.test:core:1.6.1")
}
