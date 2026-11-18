import { createCn } from "cn/config";

export const cn = createCn({
  extend: {
    classGroups: {
      "font-size": [{ text: ["micro", "small", "body", "heading", "title", "display"] }],
      shadow: [{ shadow: ["lift", "float", "well"] }],
    },
  },
});
