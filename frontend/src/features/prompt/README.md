# 提示词与 LLM 编辑

负责表格提示词引用、模板、单格覆盖、优化请求、逐行结果审阅以及独立 LLM 面板。

源码入口：table_prompt_model.mjs、table_prompt_template.mjs：片段和展开；prompt_optimization_controller.mjs：请求与审阅；prompt_optimization_model.mjs：身份和输入戳；llm_io_panel.mjs：独立 LLM 交互。

协作边界：编辑通过原生文档控制器；模型运输通过绑定的业务端口。引用顺序、处理要求和上下文上限是请求合同的一部分。

视频设置中的多图与混合参考统一显示为“全能参考”，新选择使用混合参考模式；打开旧配置只统一显示名称，不改写已保存的模式和素材。独立生成节点的参数摘要按文字宽度显示，空间不足时收缩。

本目录的可编辑源位于 `frontend/src/features/prompt/`。若在 `web/` 看到同名文档，它是构建副本；回到源码修改，再从仓库根目录构建。所有下述命令均从仓库根目录执行。

```powershell
node --import ./tests/migrated_business/register.mjs --test tests/migrated_business/prompt_optimization_controller.test.mjs tests/migrated_business/prompt_optimization_history_review.test.mjs tests/migrated_business/table_prompt_template.test.mjs tests/generation_frontend/qwen_contract.test.mjs
```


表格组合经 application/table_model.mjs 和 table_editor.mjs；通用引用菜单与内联控件归 ui。提示词列保留结构化片段、模板及单格覆盖，服务只提供可审阅结果。尚无单独页面，可在 [表格预览](../../../../dev/table/README.md) 检查真实提示词组件；优化服务在该页不可用，不代表两 LLM 宿主验收。
