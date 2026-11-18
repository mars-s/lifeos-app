import {
  Airplane,
  Barbell,
  BookOpen,
  Briefcase,
  Camera,
  ChartLine,
  Code,
  Coffee,
  Flask,
  GameController,
  Globe,
  GraduationCap,
  Heart,
  House,
  Leaf,
  Lightbulb,
  MusicNotes,
  PawPrint,
  PencilSimple,
  Rocket,
  ShoppingCart,
  Users,
  Wallet,
  Wrench,
  type Icon,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { AreaDot, areaVar, type AreaColour } from "./area";

export const AREA_ICONS = {
  "graduation-cap": { label: "Study", icon: GraduationCap },
  "book-open": { label: "Reading", icon: BookOpen },
  briefcase: { label: "Work", icon: Briefcase },
  code: { label: "Code", icon: Code },
  flask: { label: "Research", icon: Flask },
  "chart-line": { label: "Growth", icon: ChartLine },
  house: { label: "Home", icon: House },
  heart: { label: "Health", icon: Heart },
  barbell: { label: "Fitness", icon: Barbell },
  users: { label: "People", icon: Users },
  wallet: { label: "Money", icon: Wallet },
  "shopping-cart": { label: "Shopping", icon: ShoppingCart },
  airplane: { label: "Travel", icon: Airplane },
  globe: { label: "World", icon: Globe },
  leaf: { label: "Garden", icon: Leaf },
  "paw-print": { label: "Pets", icon: PawPrint },
  "music-notes": { label: "Music", icon: MusicNotes },
  camera: { label: "Photos", icon: Camera },
  "game-controller": { label: "Play", icon: GameController },
  coffee: { label: "Rest", icon: Coffee },
  "pencil-simple": { label: "Writing", icon: PencilSimple },
  lightbulb: { label: "Ideas", icon: Lightbulb },
  wrench: { label: "Fixing", icon: Wrench },
  rocket: { label: "Launch", icon: Rocket },
} as const satisfies Record<string, { label: string; icon: Icon }>;

export type AreaIconName = keyof typeof AREA_ICONS;

export const isAreaIcon = (name: string | undefined): name is AreaIconName => name !== undefined && name in AREA_ICONS;

export const AreaGlyph = ({ colour, icon, className }: { colour: AreaColour; icon?: string; className?: string }) => {
  if (!isAreaIcon(icon)) return <AreaDot colour={colour} className={cn("size-2.5", className)} />;
  const Glyph = AREA_ICONS[icon].icon;
  return (
    <Glyph
      weight="fill"
      aria-hidden="true"
      className={cn("size-4 shrink-0 transition-[color] duration-(--dur-fast)", className)}
      style={{ color: areaVar(colour) }}
    />
  );
};
