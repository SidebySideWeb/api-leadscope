import { googleMapsService } from "../services/googleMaps.js";

(async () => {
  const results = await googleMapsService.searchPlaces(
    "Λογιστικά γραφεία Αθήνα"
  );

  console.log("RESULT COUNT:", results.length);

  console.dir(results[0], { depth: null });
})();
