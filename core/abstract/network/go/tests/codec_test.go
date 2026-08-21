// Package tests: codec 帧编解码单元测试
package tests

import (
	"bytes"
	"testing"

	"github.com/wildwood/net/codec"
)

func TestEncodeDecodeFrame_RoundTrip(t *testing.T) {
	cases := []struct {
		name    string
		msgType string
		payload []byte
	}{
		{"empty_payload", "C2S_Heartbeat", []byte{}},
		{"short_payload", "C2S_Handshake", []byte{0x01, 0x02, 0x03}},
		{"long_payload", "S2C_WorldDelta", bytes.Repeat([]byte{0xab}, 1024)},
		{"max_payload", "S2C_WorldDelta", bytes.Repeat([]byte{0xcd}, 4*1024)}, // 4 KB 上限
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			data, err := codec.EncodeFrame(codec.Frame{Type: tc.msgType, Payload: tc.payload})
			if err != nil {
				t.Fatalf("encode: %v", err)
			}
			rdr := codec.NewReader()
			frames, err := rdr.Feed(data)
			if err != nil {
				t.Fatalf("feed: %v", err)
			}
			if len(frames) != 1 {
				t.Fatalf("want 1 frame, got %d", len(frames))
			}
			if frames[0].Type != tc.msgType {
				t.Errorf("type mismatch: want %q, got %q", tc.msgType, frames[0].Type)
			}
			if !bytes.Equal(frames[0].Payload, tc.payload) {
				t.Errorf("payload mismatch: want %x, got %x", tc.payload, frames[0].Payload)
			}
		})
	}
}

func TestStreamReader_PartialFeed(t *testing.T) {
	// 一次发 3 帧,但每次只 feed 1 字节,验证流式解析
	data1, _ := codec.EncodeFrame(codec.Frame{Type: "C2S_A", Payload: []byte{0x01}})
	data2, _ := codec.EncodeFrame(codec.Frame{Type: "C2S_B", Payload: []byte{0x02, 0x03}})
	data3, _ := codec.EncodeFrame(codec.Frame{Type: "C2S_C", Payload: []byte{0x04, 0x05, 0x06}})

	merged := append(append(append([]byte{}, data1...), data2...), data3...)

	rdr := codec.NewReader()
	got := []codec.Frame{}
	for _, b := range merged {
		frames, err := rdr.Feed([]byte{b})
		if err != nil {
			t.Fatalf("feed: %v", err)
		}
		got = append(got, frames...)
	}
	if len(got) != 3 {
		t.Fatalf("want 3 frames, got %d", len(got))
	}
	wantTypes := []string{"C2S_A", "C2S_B", "C2S_C"}
	wantPayloads := [][]byte{{0x01}, {0x02, 0x03}, {0x04, 0x05, 0x06}}
	for i := range wantTypes {
		if got[i].Type != wantTypes[i] {
			t.Errorf("frame %d: want type %q, got %q", i, wantTypes[i], got[i].Type)
		}
		if !bytes.Equal(got[i].Payload, wantPayloads[i]) {
			t.Errorf("frame %d: want payload %x, got %x", i, wantPayloads[i], got[i].Payload)
		}
	}
}

func TestFrame_TooLarge(t *testing.T) {
	huge := bytes.Repeat([]byte{0xff}, codec.MaxFrameSize+1)
	_, err := codec.EncodeFrame(codec.Frame{Type: "X", Payload: huge})
	if err == nil {
		t.Fatal("want error for oversized payload, got nil")
	}
}

func TestFrame_EmptyType(t *testing.T) {
	_, err := codec.EncodeFrame(codec.Frame{Type: "", Payload: []byte{0x01}})
	if err == nil {
		t.Fatal("want error for empty type, got nil")
	}
}

func TestEncodeFramePooled_MatchesNonPooled(t *testing.T) {
	f := codec.Frame{Type: "C2S_Test", Payload: []byte{0x01, 0x02, 0x03, 0x04, 0x05}}
	a, err := codec.EncodeFrame(f)
	if err != nil {
		t.Fatal(err)
	}
	b, err := codec.EncodeFramePooled(f)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(a, b) {
		t.Errorf("pooled output differs from non-pooled:\n a=%x\n b=%x", a, b)
	}
}
