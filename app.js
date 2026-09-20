"use strict";

try {
  require("./dist/server.js");
} catch (error) {
  console.error("Could not start the API. Run `npm run build` in fitness-freak-backend first.");
  console.error(error);
  process.exit(1);
}
