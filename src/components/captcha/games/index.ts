import type { ComponentType } from "react";
import type { GameType } from "@shared/captcha";
import type { GameProps } from "./types";
import { DragTargetGame } from "./DragTargetGame";
import { SlideGame } from "./SlideGame";
import { TapMatchGame } from "./TapMatchGame";
import { RotateGame } from "./RotateGame";
import { ConnectGame } from "./ConnectGame";
import { SortGame } from "./SortGame";
import { PathTraceGame } from "./PathTraceGame";
import { KeyCountGame } from "./KeyCountGame";

export const GAME_VIEWS: Record<GameType, ComponentType<GameProps>> = {
  slide: SlideGame,
  "drag-target": DragTargetGame,
  "tap-match": TapMatchGame,
  rotate: RotateGame,
  connect: ConnectGame,
  "sort-3": SortGame,
  "path-trace": PathTraceGame,
  "key-count": KeyCountGame,
};
