export type OnlineUser = {
  userId: number;
  email: string;
  color: string;
  socketId: string;
};

export type RoomState = {
  modelName: string;
  users: Map<string, OnlineUser>; // key = userId (stringified)
};
