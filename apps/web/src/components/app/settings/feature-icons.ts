import { FrameCorners, MapPin, Stamp, type Icon } from "@phosphor-icons/react";
import type { FeatureIcon } from "@lifeos/backend/features";
import { AiMark } from "@/components/lifeos/ai-mark";

export const FEATURE_ICONS = { ai: AiMark, mapPin: MapPin, stamp: Stamp, frame: FrameCorners } satisfies Record<FeatureIcon, Icon>;
