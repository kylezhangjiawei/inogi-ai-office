-- 「路由是否生效」可观测化：AiGatewayRequest 记录本次调用的选模来源与调度策略。
-- routeSource: route=命中路由 / fallback=回落调用方默认 / user=用户显式选模 / vision=视觉跳过路由。
-- 存量行保持 NULL（未知），前端按「未知」展示，不做回填。
ALTER TABLE "AiGatewayRequest" ADD COLUMN "routeSource" VARCHAR(10);
ALTER TABLE "AiGatewayRequest" ADD COLUMN "strategy" VARCHAR(30);
