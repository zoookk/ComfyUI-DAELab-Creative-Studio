# 结构化表格编辑

拥有记录、字段、单元格编辑、选择、结构修改、素材单元格以及工作台视图。

公共模型入口为 `index.ts` 的 `createTableModel(extensions)`，类型见 `contracts.ts`。基础模型通过实例参数接收列格式扩展；原生文档端口复用 `NativeDocumentPort<TableData>`。

`application/table_model.mjs` 装配现有提示词格式，`application/table_editor.mjs` 装配编辑器的提示词表头、生成历史和内容呈现。`data_table_model.mjs`、`data_table_editor.mjs` 为兼容转发，不维护第二套实现。`editor_runtime.mjs` 拥有编辑事务和视图；共享按钮、引用菜单、内联编辑和素材缩略图已归 `ui/`。

视图公共入口为 `view.ts` 的 `createTableEditor`，也由 `index.ts` 导出。面板、上传、通知、确认、剪贴板和列呈现通过参数注入；上传接收实例 AbortSignal。视图释放会取消票据、关闭对话框并移除根监听器。跨表结构剪贴板由宿主显式共享，预览可使用独立缓存。

素材组合、工作台和面板装配归 `application/table_*`，共享文本侧栏与主题归 `ui/`。旧路径只转发；基础核心 `core_model.mjs` 还为直接执行 ESM 的评估工具提供入口。真实 ComfyUI 验收在 T4 记录。

独立开发：`npm run dev:table` 打开双实例页面；`npm run test:table` 执行合同与扩展测试；`npm run test:table:ui` 执行浏览器检查。环境、端口、数据和模拟限制见 [预览说明](../../../dev/table/README.md)。

协作边界：原生工作流是表数据保存依据；默认素材、提示词两列与三行，500 行和 64 列上限保持。生成列按需添加，类型名称和默认列名为“生成列（仅测试用）”；新增列不提供勾选类型。生成和优化功能经各自控制器接入。

本目录的可编辑源位于 `frontend/src/features/table/`。若在 `web/` 看到同名文档，它是构建副本；回到源码修改，再从仓库根目录构建。所有下述命令均从仓库根目录执行。

```powershell
node --import ./tests/migrated_business/register.mjs --test tests/migrated_business/data_table.test.mjs tests/migrated_business/table_structure.test.mjs tests/migrated_business/table_inline_tab_boundary.test.mjs tests/migrated_business/table_transaction_serialization.test.mjs
```


公开辅助入口 [public_helpers.mjs](../../../frontend/src/features/table/public_helpers.mjs) 提供节点安装协调、面板视图切换、素材快照与引用查询，调用方须显式传入拥有对象。架构规则见 [table_boundary.mjs](../../../tools/table_boundary.mjs)；旧包装只转发，生产模块不得导入它们。实际验收与未通过项见 [T4 记录](../../../docs/validation/MODULARITY_T4_20261027.md)。
