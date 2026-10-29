# AIDE 兼容性

兼容性分为三层：已安装、已同步和提供方实际调用。详细证据与英文原始表格见 [COMPATIBILITY.md](COMPATIBILITY.md)。

“Blocked” 表示本地安装摘要一致，但提供方认证、模型权限或网络阻断了真实调用，不代表 `design-guide` 执行失败。

重新执行真实调用测试（可能消耗外部模型额度）：

```bash
python3 scripts/smoke-aides.py \
  --aide qwen \
  --aide cursor \
  --yes-consume-provider-quota
```
