import { NextFunction } from "connect";
import { Context, Middleware } from "koa";
import { QueryRunner, getRepository, EntityMetadata } from "typeorm";
import { Container } from "typedi";

import { GroupsOperation } from "@/decorators/Groups";
import { RouteMetadata, EntityRouterOptions } from "@/router/EntityRouter";

import { GenericEntity } from "@/router/EntityRouter";
import { MappingManager } from "../services/MappingManager";
import { Cleaner } from "@/serializer/Cleaner";
import { Formater } from "@/serializer/Formater";
import { BridgeRouter } from "@/bridges/routers/BridgeRouter";

export abstract class AbstractRouteAction implements IRouteAction {
    protected middlewares: Middleware[];
    protected routeMetadata: RouteMetadata;
    protected entityMetadata: EntityMetadata;

    get formater() {
        return Container.get(Formater) as Formater;
    }

    get cleaner() {
        return Container.get(Cleaner) as Cleaner;
    }

    get mappingManager() {
        return Container.get(MappingManager);
    }

    constructor(args: RouteActionConstructorArgs & RouteActionConstructorData) {
        const { middlewares, routeMetadata, entityMetadata } = args;
        this.middlewares = middlewares;
        this.routeMetadata = routeMetadata;
        this.entityMetadata = entityMetadata;
    }

    abstract onRequest(ctx: Context, next: NextFunction): Promise<any>;

    protected getQueryRunner(ctx: Context): QueryRunner {
        return ctx.state.queryRunner;
    }

    protected async serializeItem<Entity extends GenericEntity = GenericEntity>(
        entity: Entity,
        operation: GroupsOperation = "details"
    ) {
        const cleaned = this.cleaner.cleanItem({
            rootMetadata: this.entityMetadata,
            operation,
            values: entity as any,
            options: this.routeMetadata.options,
        });
        const repository = getRepository<Entity>(entity.constructor.name);
        const entityInstance: Entity = repository.manager.create(repository.metadata.targetName, cleaned as any);

        return this.formater.formatItem({
            item: entityInstance,
            operation,
            entityMetadata: this.entityMetadata,
            options: this.routeMetadata.options,
        });
    }

    protected throw(ctx: Context, message: string) {
        ctx.body = { error: message };
        ctx.status = 400;
    }
}

export type RouteActionConstructorArgs = { middlewares: Middleware[] };
export type RouteActionConstructorData = { routeMetadata: RouteMetadata; entityMetadata: EntityMetadata };

export interface IRouteAction {
    onRequest(ctx: Context, next: NextFunction): Promise<any>;
}

export type RouteActionClass<T extends object = object> = new (
    args?: RouteActionConstructorArgs,
    data?: T
) => IRouteAction;

// TODO Rename to RouteAction instead of CustomAction
export type CustomActionRouterConfigNew = Pick<EntityRouterOptions, "routerClass" | "routerRegisterFn">;
export type CustomActionRouterConfigWithInstance = {
    /** Existing router to pass on which custom actions routes will be registered */
    router: BridgeRouter;
};
export type CustomActionRouterConfig = CustomActionRouterConfigWithInstance | CustomActionRouterConfigNew;
export type CustomActionOptions<T extends object = object> = {
    /** Args to pass to CustomActionClass on creating a new instance */
    args?: T;
};