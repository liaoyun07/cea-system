# UI-14 镜像应用关联与服务部署

按用户确认，镜像详情只展示“关联应用版本”和“服务部署”；有关联应用即按使用中保护，不判断流程任务是否运行，不展示已完成Job历史。服务部署指当前平台管理的Deployment能力，不是Kubernetes Service网络对象。

RegistryManagementService.detail沿原接口增加applications/deployments两个字符串数组。应用关联来自活动目录的直接引用、同应用分发路径与源摘要匹配，以及原分发记录中的应用版本；因此源路径与副本路径不同仍能显示关联，旧无分发记录副本和已有精确副本复用不漏关联。删除的应用版本仅作为库存发现线索，不算活动关联。分发记录有历史摘要时，即使源tag移动也保持关联。

KubernetesManagementService新增现有权限范围内的Deployment镜像查询，包含零副本、init容器，返回集群/Namespace/部署名称供页面显示；镜像详情/删除不再调用全量workloadImages，不查询Job/Pod/ReplicaSet历史或运行状态。应用目录删除自身的原检查不在本批修改范围。

删除沿原接口重新检查：有活动应用或Deployment关联即拒绝；原多平台索引、未结束分发、无法确认部署查询等阻碍保持，不新增其他防护分支。孤立Job/Pod、StatefulSet/DaemonSet/CronJob不属于本次镜像删除保护，外部创建对象应先登记应用；这是用户选择的简化范围，不承诺任意Kubernetes工作负载的通用防删。历史记录不被删除。

仅修改已有Java文件及前端，增加两个响应字段与内部查询方法；无新生产类、接口路径、表、迁移、缓存或执行链。属于镜像管理，不涉及Kestra通用工作流语义。

验收：真实Registry源/副本关联、无分发记录副本、复用版本、源tag移动、零副本Deployment；真实已完成Job仍保留时允许清理已解除关联的镜像；权限/确认/索引保护回归；实际页面两类关联、禁删、空/失败和桌面/窄屏。发布前后端并只读检查现有业务与无关服务保持。[协议](../contracts/ui09-registry-kubernetes.md)、[验证](../verification/VER-UI-014-image-associations.md)。
