# 业务节点宿主适配

把表格、分镜、文稿、LLM 和独立生成功能绑定到原生节点、widget、编辑历史和公开画布适配器。

源码入口：business_bootstrap.js：端口装配；business_document_host.ts：原生文档绑定；data_table_nodes.mjs、table_serializer.ts：表格；video_generate.js：生成节点唯一面板所有者；dynamic_widget_lifecycle.mjs：动态控件清理。

协作边界：原生图负责编辑数据；业务面板必须取得文档绑定和稳定身份。正式生成入口为 video_generate.js，旧重复 libtv_panel.js 已移除。

生成面板在线路变更完成后同步输入；创作画布通过适配器 `refresh` 继续同步表格内容，不依赖原生画布绘制。

多维表格的原生 `source_table` 仅接受表格输出。恢复旧工作流时断开误接的文本等非表格来源，保留本地表格内容及有效表格连接，避免隐藏旧连线阻塞生成节点读取。

本目录的可编辑源位于 `frontend/src/integrations/comfyui/business/`。若在 `web/` 看到同名文档，它是构建副本；回到源码修改，再从仓库根目录构建。所有下述命令均从仓库根目录执行。

```powershell
node --import ./tests/migrated_business/register.mjs --test tests/migrated_business/business_entrypoints.test.mjs tests/migrated_business/generation_entrypoints.test.mjs tests/migrated_business/table_widget_serializer.test.mjs tests/migrated_business/dynamic_widget_lifecycle.test.mjs
```

