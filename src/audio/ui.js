/**
 * UiAudio — UI-event sound façade (button click, hover, panel open/close).
 */
'use strict';

export class UiAudio {
  constructor(audio) { this.audio = audio; }

  onClick()  { this.audio && this.audio.play && this.audio.play('ui_click'); }
  onHover()  { this.audio && this.audio.play && this.audio.play('ui_hover'); }
  onOpen()   { this.audio && this.audio.play && this.audio.play('ui_open'); }
  onClose()  { this.audio && this.audio.play && this.audio.play('ui_close'); }
  onError()  { this.audio && this.audio.play && this.audio.play('ui_error'); }
  onConfirm(){ this.audio && this.audio.play && this.audio.play('craft'); }
}
