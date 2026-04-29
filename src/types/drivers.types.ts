// Matches the `drivers` table columns (driver column aliased to name for cleaner API output)
export interface DriverResult {
  id: number;
  name: string;
  description: string | null;
  driver_group: string | null;
}

// Matches the `sub_drivers` table columns
export interface SubDriverResult {
  id: number;
  driver_type: string | null;
  driver_description: string | null;
  management_driver_id: number;
}
