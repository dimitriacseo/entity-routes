import { getRepository, EntityMetadata } from "typeorm";
import { Container, Service } from "typedi";

import { GenericEntity, EntityRouteOptions } from "@/router/EntityRouter";
import { Cleaner } from "@/request/Cleaner";
import { ValidateItemOptions, EntityErrorResults, Validator } from "@/request/Validator";
import { RequestContextMinimal } from "@/router/MiddlewareMaker";
import { SubresourceRelation } from "@/router/SubresourceManager";
import { EntityMapperMakeOptions } from "@/mapping/index";

@Service()
export class Persistor {
    get cleaner() {
        return Container.get(Cleaner);
    }

    get validator() {
        return Container.get(Validator);
    }

    /** Clean & validate item and then save it if there was no error */
    public async saveItem<Entity extends GenericEntity = GenericEntity>({
        ctx,
        rootMetadata,
        validatorOptions,
        mapperMakeOptions,
        subresourceRelation,
        hooks,
    }: SaveItemArgs<Entity>) {
        const { requestId, operation, values } = ctx;
        const repository = getRepository<Entity>(rootMetadata.target);
        // TODO Add options to bypass clean/validate steps

        const cleanOptions = { rootMetadata, operation, values, options: mapperMakeOptions };
        await hooks?.beforeClean?.(cleanOptions);
        const cleanedItem = this.cleaner.cleanItem(cleanOptions);
        await hooks?.afterClean?.(cleanOptions, cleanedItem);

        const item = repository.create(cleanedItem);

        // Allow partially updating an entity
        const defaultValidatorOptions: Partial<ValidateItemOptions> =
            operation === "update" ? { skipMissingProperties: true } : {};
        const validationOptions = { ...defaultValidatorOptions, ...validatorOptions, context: ctx };

        await hooks?.beforeValidate?.(validationOptions as any);
        const errors = await this.validator.validateItem(rootMetadata, item, validationOptions);
        await hooks?.afterValidate?.(validationOptions as any, errors);

        if (!Object.keys(item).length) {
            throw new Error(
                `Item can't be saved since it's empty, check your @Groups on <${rootMetadata.name}> with <${operation}> operation`
            );
        }

        if (Object.keys(errors).length) {
            return { hasValidationErrors: true, errors } as EntityErrorResponse;
        }

        // Auto-join subresource parent on body values
        if (
            subresourceRelation?.relation?.inverseRelation &&
            (subresourceRelation.relation.inverseRelation.isOneToOne ||
                subresourceRelation.relation.inverseRelation.isManyToOne)
        ) {
            (item as any)[subresourceRelation.relation.inverseRelation.propertyName] = { id: subresourceRelation.id };
        }

        await hooks?.beforePersist?.({ requestId, item });
        const result = await repository.save(item);
        await hooks?.afterPersist?.({ requestId, result });

        return result;
    }
}

export type EntityErrorResponse = { hasValidationErrors: true; errors: EntityErrorResults };

export type SaveItemArgs<Entity extends GenericEntity = GenericEntity> = {
    /** Metadata from entity to save */
    rootMetadata: EntityMetadata;
    /** Minimal request context (with only relevant parts) */
    ctx: RequestContextMinimal<Entity>;
    /** Used by class-validator & entity-validator */
    validatorOptions?: ValidateItemOptions;
    /** EntityMapper make options */
    mapperMakeOptions?: EntityMapperMakeOptions;
    /** Subresource relation used to auto join saved entity with its parent */
    subresourceRelation?: SubresourceRelation;
} & Pick<EntityRouteOptions, "hooks">;
