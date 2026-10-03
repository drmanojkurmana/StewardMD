#pragma once
/* Host stand-in for <android/log.h> (test/native-host only): the JNI sources compile unchanged. */
#include <stdarg.h>
#define ANDROID_LOG_DEBUG 3
#define ANDROID_LOG_INFO 4
#define ANDROID_LOG_WARN 5
#define ANDROID_LOG_ERROR 6
#ifdef __cplusplus
extern "C"
#endif
int __android_log_print(int, const char*, const char*, ...);
