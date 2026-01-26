// Workaround for dotprompt -> handlebars CJS import type resolution.
// `@types/handlebars` doesn't declare this deep import path.
declare module "handlebars/dist/cjs/handlebars.js" {
  import Handlebars = require("handlebars");
  export = Handlebars;
}

