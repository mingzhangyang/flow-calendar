/**
 * 视角：你正在看哪个时间。
 * 第 1 步里视角永远停在“现在”；第 2 步会加入拖动和回弹。
 */
export class Viewport {
  /** 视角相对现在的偏移，毫秒。正数是未来，负数是过去。 */
  offset = 0;

  viewTime(now: number): number {
    return now + this.offset;
  }

  /** 视角是否还在运动（拖动或回弹中） */
  isMoving(): boolean {
    return false;
  }
}
