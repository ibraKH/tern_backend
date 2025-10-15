import swaggerJSDoc from "swagger-jsdoc";

export const swaggerSpec = swaggerJSDoc({
  definition: {
    openapi: "3.1.0",
    info: {
      title: "TERN API",
      version: "1.0.0",
      description: "REST API for TERN",
    },
    servers: [
      { url: "http://localhost:3000", description: "Local" },
      { url: "https://hammerhead-app-t8l9y.ondigitalocean.app/", description: "Production" },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
  },
  apis: ["./src/routes/**/*.ts", "./src/index.ts"],
});
