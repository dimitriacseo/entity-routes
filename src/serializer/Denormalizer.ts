import { validate, ValidatorOptions } from "class-validator";
import { DeepPartial, QueryRunner, getRepository, EntityMetadata } from "typeorm";
import { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";
import { isObject, isPrimitive } from "util";
import { EntityValidatorFunctionOptions } from "@astahmer/entity-validator";
import Container, { Service } from "typedi";

import { validateEntity } from "@/validators";
import { RequestContext } from "@/services/ResponseManager";
import { isType, isEntity } from "@/functions/asserts";
import { Primitive } from "@/functions/primitives";
import { formatIriToId } from "@/functions/entity";
import { GenericEntity, EntityRouteOptions } from "@/services/EntityRoute";
import { MappingManager, MappingItem, ENTITY_META_SYMBOL } from "@/services/MappingManager";

@Service()
export class Denormalizer<Entity extends GenericEntity = GenericEntity> {
    get mappingManager() {
        return Container.get(MappingManager);
    }

    /** Method used when making a POST request */
    public async insertItem(
        rootMetadata: EntityMetadata,
        ctx: RequestContext<Entity>,
        options?: DenormalizerValidatorOptions,
        queryRunner?: QueryRunner,
        routeOptions?: EntityRouteOptions
    ) {
        const operation = ctx.operation || "create";
        return this.saveItem(rootMetadata, { ...ctx, operation }, options, queryRunner, routeOptions);
    }

    /** Method used when making a PUT request on a specific id */
    public async updateItem(
        rootMetadata: EntityMetadata,
        ctx: RequestContext<Entity>,
        options?: DenormalizerValidatorOptions,
        queryRunner?: QueryRunner,
        routeOptions?: EntityRouteOptions
    ) {
        const operation = ctx.operation || "update";
        return this.saveItem(rootMetadata, { ...ctx, operation }, options, queryRunner, routeOptions);
    }

    /** Clean & validate item and then save it if there was no error */
    private async saveItem(
        rootMetadata: EntityMetadata,
        ctx: RequestContext<Entity>,
        options?: DenormalizerValidatorOptions,
        queryRunner?: QueryRunner,
        routeOptions?: EntityRouteOptions
    ) {
        const { operation, values } = ctx;
        const repository = queryRunner
            ? queryRunner.manager.getRepository<Entity>(rootMetadata.target)
            : getRepository<Entity>(rootMetadata.target);
        const cleanedItem = this.cleanItem(rootMetadata, operation, values, routeOptions);
        const item = repository.create(cleanedItem as DeepPartial<Entity>);

        const validatorOptions: Partial<DenormalizerValidatorOptions> =
            operation === "updatexport e" ? { skipMissingProperties: false } : {};
        const errors = await this.validateItem(rootMetadata, item, {
            ...validatorOptions,
            ...options,
            context: ctx,
        });

        if (Object.keys(errors).length) {
            return { hasValidationErrors: true, errors } as EntityErrorResponse;
        }

        return repository.save(item);
    }

    /** Return a clone of this request body values with only mapped props */
    public cleanItem(
        rootMetadata: EntityMetadata,
        operation: RequestContext["operation"],
        values: RequestContext<Entity>["values"],
        options: EntityRouteOptions
    ): RequestContext<Entity>["values"] {
        const routeMapping = this.mappingManager.make(rootMetadata, operation, options);
        return this.recursiveClean(values, {}, [], routeMapping as MappingItem);
    }

    /** Removes non-mapped (deep?) properties from sent values & format entity.id */
    private recursiveClean(
        item: RequestContext<Entity>["values"] | string,
        clone: any,
        currentPath: string[],
        routeMapping: MappingItem
    ): QueryDeepPartialEntity<Entity> {
        let key: string, prop, mapping, nestedMapping;

        // If item is an iri/id (coming from an array), just return it in object with proper id
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

    /** Recursively validate sent values & returns errors for each entity not passing validation */
    private async recursiveValidate(
        rootMetadata: EntityMetadata,
        item: Entity,
        currentPath: string,
        errorResults: Record<string, EntityError[]>,
        options: DenormalizerValidatorOptions
    ) {
        let key: string, prop: any;

        const keys = Object.keys(item);
        // If user is updating entity and item is just an existing relation, no need to validate it since it's missing properties
        if ((options.skipMissingProperties || currentPath.includes(".")) && keys.length === 1 && keys[0] === "id") {
            return [];
        }

        const routeEntityName = rootMetadata.name.toLocaleLowerCase();
        // Add default groups [entity, entity_operation]
        const groups = (options.groups || []).concat([
            routeEntityName,
            routeEntityName + "_" + options.context.operation,
        ]);
        const validationOptions = { ...options, groups };

        const [propErrors, classErrors] = await Promise.all([
            validate(item, validationOptions),
            validateEntity(item, validationOptions),
        ]);
        const itemErrors: EntityError[] = propErrors
            .concat(classErrors)
            .map((err) => ({ currentPath, property: err.property, constraints: err.constraints }));

        if (itemErrors.length) {
            // Gotta use item.className for root level errors in order to have a non-empty string as a key
            errorResults[currentPath || routeEntityName] = itemErrors;
        }

        // Recursively validates item.props
        const makePromise = (nestedItem: Entity, path: string): Promise<void> =>
            new Promise(async (resolve) => {
                try {
                    const errors = await this.recursiveValidate(rootMetadata, nestedItem, path, errorResults, options);
                    if (errors.length) {
                        errorResults[path] = errors;
                    }
                    resolve();
                } catch (error) {
                    console.error(`Validation failed at path ${path}`);
                    console.error(error);
                    resolve();
                }
            });

        const path = currentPath ? currentPath + "." : "";

        // Parallel validation on item.props
        const promises: Promise<void>[] = [];
        for (key in item) {
            prop = (item as Record<string, any>)[key];

            if (Array.isArray(prop)) {
                let i = 0;
                for (i; i < prop.length; i++) {
                    promises.push(makePromise(prop[i], `${path}${key}[${i}]`));
                }
            } else if (isEntity(prop)) {
                promises.push(makePromise(prop, `${path}${key}`));
            }
        }

        await Promise.all(promises);

        return itemErrors;
    }

    /** Validates sent values & return a record of validation errors */
    private async validateItem(rootMetadata: EntityMetadata, item: Entity, options: DenormalizerValidatorOptions) {
        const errors: EntityErrorResults = {};
        await this.recursiveValidate(rootMetadata, item, "", errors, options);
        return errors;
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

export const hasAnyValidationGroupMatchingForRequest = (routeEntityName: string, operation: string) => (
    group: string
) => group === routeEntityName || group === routeEntityName + "_" + operation;

export type EntityError = {
    currentPath: string;
    property: string;
    constraints: {
        [type: string]: string;
    };
};
export type EntityErrorResults = Record<string, EntityError[]>;
export type EntityErrorResponse = { hasValidationErrors: true; errors: EntityErrorResults };

export type DenormalizerValidatorOptions = ValidatorOptions & EntityValidatorFunctionOptions<RequestContext>;
