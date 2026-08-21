# Wildwood M1.5 网络协议语义层 — 编译脚本
#
# 依赖:protoc 25.1 + protoc-gen-go v1.34.2 (在 .aily/.cli/bin)
# 详见 gen.sh

GO_DIR := go
PROTO_DIR := proto
HASH_FILE := $(GO_DIR)/.proto_hash

.PHONY: all gen check install-deps test sizeaudit clean

all: gen test sizeaudit

gen:
	./gen.sh

check:
	./gen.sh --check

install-deps:
	./gen.sh --install-deps

test:
	cd $(GO_DIR) && go test ./... -count=1 -timeout 60s

sizeaudit:
	cd $(GO_DIR) && go run ./cmd/sizeaudit

clean:
	rm -f $(HASH_FILE)
	rm -rf $(GO_DIR)/wildwood
