export type OnlineUser = {
  userId: number;
  email: string;
  color: string;
};

export type RoomState = {
  modelName: string;
  users: Map<string, OnlineUser>; // key = userId (stringified)
  socketIdByUserId: Map<string, string>; // internal only; never sent to clients
};
