// Host-test shim only: std::__1::__hash_memory first ships in libc++ 21; Ubuntu 24.04 has 20.
#include <functional>
namespace std { inline namespace __1 {
  size_t __hash_memory(const void* p, size_t n) noexcept { return __murmur2_or_cityhash<size_t>()(p, n); }
} }
