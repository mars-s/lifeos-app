import { MapPin, Sparkle, Stamp, type Icon } from "@phosphor-icons/react";
import type { FeatureIcon } from "@lifeos/backend/features";

export const FEATURE_ICONS = { sparkle: Sparkle, mapPin: MapPin, stamp: Stamp } satisfies Record<FeatureIcon, Icon>;
