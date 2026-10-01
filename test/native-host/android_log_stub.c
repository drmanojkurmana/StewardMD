/* Host stand-in for liblog: prints only when JNI_LOG is set. */
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
int __android_log_print(int p, const char* t, const char* f, ...) {
  va_list a; va_start(a, f);
  if (getenv("JNI_LOG")) { fprintf(stderr, "[%s] ", t); vfprintf(stderr, f, a); fputc('\n', stderr); }
  va_end(a); return 0;
}
