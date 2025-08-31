import express from "express";
import { createServer } from "node:http";                                  //connects socket and express srever
import { Server } from "socket.io";
import mongoose from "mongoose";
import cors from "cors";
import { connectToSocket } from "./controllers/socketManager.js";
import userRoutes from "./routes/users.routes.js";


const app = express();
//app ka instance create kiya phir server pr  gye phir create server kiya phir whan app rkh diya
const server = createServer(app);
const io = connectToSocket(server);


app.set("port", (process.env.PORT || 8000))
app.use(cors());
app.use(express.json({ limit: "40kb" }));                              //no extra payload occurs
app.use(express.urlencoded({ limit: "40kb", extended: true }));
app.use("/api/v1/users" , userRoutes);


const start = async () => {
    const connectionDb = await mongoose.connect("mongodb+srv://khushigoenka5253:khushi123@cluster0.tzlsfgq.mongodb.net")
    console.log(`Mongo connected Db host: ${connectionDb.connection.host}`)
    server.listen(app.get("port"), () => {
        console.log("Listening at port 8000")
    });
}
start();
