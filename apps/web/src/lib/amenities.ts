import { Bath, Car, ChefHat, Dumbbell, Flame, Fan, Laptop, PawPrint, Sunrise, Tv, Waves, WashingMachine, Wifi, Coffee, type LucideIcon } from "lucide-react";

export const AMENITY_META: Record<string, { label: string; icon: LucideIcon }> = {
  wifi: { label: "Wi-Fi", icon: Wifi },
  kitchen: { label: "Kitchen", icon: ChefHat },
  ac: { label: "Air conditioning", icon: Fan },
  heating: { label: "Heating", icon: Flame },
  parking: { label: "Free parking", icon: Car },
  pool: { label: "Pool", icon: Waves },
  washer: { label: "Washing machine", icon: WashingMachine },
  tv: { label: "TV", icon: Tv },
  workspace: { label: "Dedicated workspace", icon: Laptop },
  gym: { label: "Gym", icon: Dumbbell },
  breakfast: { label: "Breakfast included", icon: Coffee },
  pets_allowed: { label: "Pets allowed", icon: PawPrint },
  balcony: { label: "Balcony", icon: Sunrise },
  hot_tub: { label: "Hot tub", icon: Bath },
};

export const PROPERTY_LABEL: Record<string, string> = {
  apartment: "Apartment",
  house: "House",
  villa: "Villa",
  room: "Private room",
  hotel: "Hotel",
  homestay: "Homestay",
  cabin: "Cabin",
};

export const POLICY_COPY: Record<string, { name: string; summary: string }> = {
  FLEXIBLE: { name: "Flexible", summary: "Full refund until 24 hours before check-in. After that, everything except the first night is refunded." },
  MODERATE: { name: "Moderate", summary: "Full refund until 5 days before check-in. After that, 50% is refunded." },
  STRICT: { name: "Strict", summary: "50% refund until 7 days before check-in. After that, no refund." },
};
