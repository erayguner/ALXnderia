import nextConfig from "eslint-config-next";
import { fixupConfigRules } from "@eslint/compat";

export default [
  ...fixupConfigRules(nextConfig),
  {
    ignores: [".next/", "node_modules/", "out/"],
  },
];
