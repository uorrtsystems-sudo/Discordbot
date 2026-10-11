export const TINY_PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

export const baseIntake = {
  idempotencyKey: "idem-key-001",
  requesterName: "Jordan Lee",
  phone: "8015550148",
  lat: 40.45,
  lon: -111.5,
  injuries: "INJURY-SENTINEL",
  vehicle: "VEHICLE-SENTINEL",
  situation: "SITUATION-SENTINEL",
  county: "COUNTY-SENTINEL",
  photoUrls: ["https://cdn.example.com/scene.png"],
};
