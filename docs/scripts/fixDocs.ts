import { getDocItemTagRefs } from "./tag-references/getDocItemTagRefs";
import { replaceTagReferences } from "./tag-references/replaceTagReferences";
import { replaceMarkdownLinks } from "./replaceMarkdownLinks";
import { renameTypedocIndex } from "./renameTypedocIndex";
import customReferences from "./references";

const pageDir = "./src/pages";
const generatedDocsDir = pageDir + "/api-reference";

const typeDocsReflections = require("../docs.json");

const typeDocRefs = Object.fromEntries(getDocItemTagRefs(typeDocsReflections));

const fromPath = pageDir;
const ignorePath = generatedDocsDir;

async function run() {
    await renameTypedocIndex({ fromPath: generatedDocsDir });
    replaceMarkdownLinks({ fromPath: generatedDocsDir });
    replaceTagReferences({ source: typeDocRefs, fromPath, ignorePath, prefix: "/api-reference/" });
    replaceTagReferences({ source: customReferences, fromPath, ignorePath });
}

export default run();
