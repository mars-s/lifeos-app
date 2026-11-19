import { createCn, type ConfigExtension, type DefaultClassGroupIds } from "cn/config";

export const classConfig = {
  extend: {
    classGroups: {
      "font-size": [{ text: ["micro", "small", "body", "heading", "title", "display"] }],
      shadow: [{ shadow: ["lift", "float", "well"] }],
    },
  },
} satisfies ConfigExtension<DefaultClassGroupIds>;

export const cn = createCn(classConfig);
