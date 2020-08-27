const tagsByReferences = {
    "/route-scope/": ["`route scope`"],
    "http://typeorm.io/": ["`TypeORM`"],
    "https://typeorm.io/#/one-to-one-relations": ["`OneToOne`"],
    "https://typeorm.io/#/many-to-one-one-to-many-relations": ["`OneToMany`", "`ManyToOne`"],
    "https://typeorm.io/#/many-to-many-relations": ["`ManyToMany`"],
};

type CustomDocRef = Record<string, string[]>;
function inverseReferences(refs: CustomDocRef): Record<string, string> {
    return Object.entries(refs).reduce(
        (acc, [url, tags]) => ({ ...acc, ...tags.reduce((tagsAcc, string) => ({ ...tagsAcc, [string]: url }), {}) }),
        {}
    );
}

export default inverseReferences(tagsByReferences);