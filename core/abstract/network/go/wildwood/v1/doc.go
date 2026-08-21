// Package wildwoodv1 是 Wildwood 项目 M1.5 网络协议语义层的 Go 绑定。
//
// 由 protoc-gen-go 从 proto/wildwood/v1/*.proto 自动生成,A/B 线共用;
// 上层(传输层/房间服务)只依赖本包,引擎(Godot / Unity)各自实现 codec
// 但消息 wire format 100% 互通(详见 codec 子包)。
package wildwoodv1
