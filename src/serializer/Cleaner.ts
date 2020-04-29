import { EntityMetadata } from "typeorm";
import { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";
import { isObject, isPrimitive } from "util";
import Container, { Service } from "typedi";

import { RequestContext } from "@/services/ResponseManager";
import { isType } from "@/functions/asserts";
import { Primitive } from "@/functions/primitives";
import { formatIriToId } from "@/functions/entity";
import { GenericEntity, EntityRouteOptions } from "@/services/EntityRouter";
import { MappingManager, MappingItem, ENTITY_META_SYMBOL } from "@/services/MappingManager";
import { SaveItemArgs } from "@/serializer/Denormalizer";

@Service()
export class Cleaner<Entity extends GenericEntity = GenericEntity> {
    get mappingManager() {
        return Container.get(MappingManager);
    }

    /** Return a clone of this request body values with only mapped props */
    public cleanItem({ rootMetadata, values, operation, options }: CleanerArgs): RequestContext<Entity>["values"] {
        const routeMapping = this.mappingManager.make(rootMetadata, operation, options);
        return this.recursiveClean(values as RequestContext<Entity>["values"], {}, [], routeMapping as MappingItem);
    }

    /** Removes non-mapped (deep?) properties from sent values & format entity.id */
    private recursiveClean(
        item: RequestContext<Entity>["values"] | string,
        clone: any,
        currentPath: string[],
        routeMapping: MappingItem
    ): QueryDeepPartialEntity<Entity> {
        let key: string, prop, mapping, nestedMapping;

        // If item is an iri/id (coming frsom an array), just return it in object with proper id
        if (isType<Primitive>(item, isPrimitive(item))) {
            mapping = this.mappingManager.getNestedMappingAt(currentPath, routeMapping);
            return mapping && mapping.exposedProps.length === 1 && mapping.exposedProps[0] === "id"
                ? { id: formatIriToId(item) }
                : clone;
        }

        for (key in item) {
            prop = item[key as keyof typeof item];
            mapping = currentPath.length
                ? this.mappingManager.getNestedMappingAt(currentPath, routeMapping)
                : routeMapping;

            if (!isPropMapped(key, mapping)) {
                continue;
            }

            if (Array.isArray(prop)) {
                if (!this.mappingManager.isPropSimple(mapping[ENTITY_META_SYMBOL], key)) {
                    clone[key] = prop.map((nestedItem) =>
                        this.recursiveClean(nestedItem, {}, currentPath.concat(key), routeMapping)
                    );
                } else {
                    clone[key] = prop;
                }
            } else if (isType<QueryDeepPartialEntity<Entity>>(prop, isObject(prop))) {
                nestedMapping = this.mappingManager.getNestedMappingAt(currentPath.concat(key), mapping);
                if (hasAnyNestedPropMapped(nestedMapping)) {
                    clone[key] = this.recursiveClean(prop, {}, currentPath.concat(key), routeMapping);
                } else if (!nestedMapping && this.mappingManager.isPropSimple(mapping[ENTITY_META_SYMBOL], key)) {
                    clone[key] = prop;
                }
            } else if (isPrimitive(prop)) {
                const isRelation = mapping[ENTITY_META_SYMBOL].findRelationWithPropertyPath(key);
                // Format IRI to id && string "id" to int id
                if (typeof prop === "string" && (isRelation || key === "id")) {
                    clone[key] = formatIriToId(prop);
                } else {
                    clone[key] = prop;
                }
            }
        }

        return clone;
    }
}

/** Checks that given prop is mapped in either select or relation props of a MappingItem */
export const isPropMapped = (prop: string, mapping: MappingItem) => mapping && mapping.exposedProps.includes(prop);

/** Checks that given item contains any nested mapped prop */
export const isAnyItemPropMapped = (item: any, mapping: MappingItem) => {
    if (mapping) {
        const nestedProps = mapping.exposedProps;
        return nestedProps.length && Object.keys(item).some((prop) => nestedProps.includes(prop));
    }
};
/** Checks that a MappingItem contains further nested props  */
export const hasAnyNestedPropMapped = (mapping: MappingItem) => mapping && mapping.exposedProps.length;

export type CleanerArgs<Entity extends GenericEntity = GenericEntity> = Pick<
    RequestContext<Entity>,
    "operation" | "values"
> &
    Pick<SaveItemArgs, "rootMetadata"> & {
        rootMetadata: EntityMetadata;
        options: EntityRouteOptions;
    };
