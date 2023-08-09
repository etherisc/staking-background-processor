import winston from "winston";

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss"}),
        winston.format.json(),
    ),
    transports: [
        new winston.transports.Console({
            level: process.env.NODE_ENV !== 'production' ? 'debug' : 'info',
        }),
        // new winston.transports.File({ 
        //     filename: 'application.log',
        //     format: winston.format.combine(
        //         winston.format.timestamp({
        //             format: "YYYY-MM-DD HH:mm:ss",
        //         }),
        //         winston.format.json()
        //     ),
        // }),
    ],
});

export { logger };
