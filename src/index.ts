import express, { Request, Response } from 'express';
import bodyParser from 'body-parser';
import services from './routers/services';
import cors from "cors";

const corsOptions = {origin: "*"};
const app = express();

app.use(cors(corsOptions));
app.use(bodyParser.urlencoded({ extended: false }))
app.use(bodyParser.json())

app.use('/api', services);

const port = 3004;

app.use((req: Request, res: Response) => {
  res.status(404).send('Page not found');
});

app.listen(port, (): void => console.log(`Listening on port : ${port}`));

export default app;