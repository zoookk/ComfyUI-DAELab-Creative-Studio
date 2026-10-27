# 生成配置与任务会话

为表内和独立生成节点共用输入构造、设置、账本查询、恢复审阅和结果应用。

源码入口：table_generation_model.mjs：最终输入和配置；generation_session.ts：异步会话；table_generation_tasks.mjs：提交与恢复；video_tasks_panel.mjs：独立节点；task_snapshots.mjs：任务展示快照。

协作边界：后端 generation 服务拥有任务事实，前端仅保存引用和编辑输入。libtv_video_model.mjs 是保留格式/配置模型，不代表启用旧 LibTV 执行通道。

生成节点按实际连线自动识别表格、文字和图片。表格及 LLM 逐行结果单独接入，文字与图片可以组合；图片依次使用空闲首帧、尾帧、参考图片入口，不覆盖已有连线。断开文字／图片连线会清除该输入及对应任务的结果预览，仍连接的输入保留；断开表格或逐行来源后恢复空白任务，保留生成设置。清理随断线进入原生撤销记录，不删除服务账本或磁盘文件。输入识别由 generation_input.ts 维护，原生连线与画布共用。

任务栏仅在连接表格或 LLM 逐行结果时显示，用于切换批量任务，不提供新增任务加号。连接文字、图片或未连接时隐藏任务栏，直接编辑当前单个任务；断线、切换来源和重载均按实际连线更新。

参考缩略图中已选为首帧或尾帧的图片显示对应文字，同一图片兼任两者时显示“首尾帧”；其余素材保留序号。标记随当前任务、生成方式及图片选择更新。

单个生成通过原生 Autogrow 接入多个文字、图片和视频来源。文字按接入顺序换行追加，更新某个来源不改变顺序，断线只移除对应内容；图片转为多图参考时保留已接入的首尾帧图片。连接素材只更新参考区和任务的素材引用，不自动向提示词插入 `@` 标签；手动添加的引用保持不变。具体生成方式仍受所选模型支持范围约束。

单个模式的素材落点建立真实连线，拉线与拖动来源节点均可使用；同一来源到同一生成节点只允许一条线。素材组通过独立 Autogrow 输入连接，读取组内文字、图片和视频，并随组内容更新。表格批量任务的素材填充保持快照行为，重复填入同一素材不再追加副本。

本目录的可编辑源位于 `frontend/src/features/generation/`。若在 `web/` 看到同名文档，它是构建副本；回到源码修改，再从仓库根目录构建。所有下述命令均从仓库根目录执行。

```powershell
node --import ./tests/migrated_business/register.mjs --test tests/generation_frontend/session.test.mjs tests/generation_frontend/table_flow.test.mjs tests/migrated_business/generation_input_regression.test.mjs tests/migrated_business/table_generation_history.test.mjs
```


输入为编辑配置和稳定任务身份，输出为账本投影及经过文档票据批准的素材引用。表内外复用请求合同，模型能力由宿主绑定。尚无独立生成页面；[表格预览](../../../../dev/table/README.md) 提供真实设置界面和明确模拟结果，不调用模型。配置字段与真实验收见 [模型指南](../../../../docs/MODELS.md) 和 [状态](../../../../docs/validation/STATUS.md)。
