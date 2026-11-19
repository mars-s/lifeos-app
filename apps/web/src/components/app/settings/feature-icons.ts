import { Hourglass, MapPin, type Icon } from "@phosphor-icons/react";
import type { FeatureIcon } from "@lifeos/backend/features";

export const FEATURE_ICONS = { hourglass: Hourglass, mapPin: MapPin } satisfies Record<FeatureIcon, Icon>;
