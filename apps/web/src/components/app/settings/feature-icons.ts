import { FrameCorners, MapPin, Stamp } from "@phosphor-icons/react";
import type { FeatureIcon } from "@lifeos/backend/features";
import { AiMark } from "@/components/lifeos/ai-orb";
import type { Glyph } from "@/lib/glyph";

export const FEATURE_ICONS = { ai: AiMark, mapPin: MapPin, stamp: Stamp, frame: FrameCorners } satisfies Record<FeatureIcon, Glyph>;
