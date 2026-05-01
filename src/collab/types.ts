export type OnlineUser = {
  userId: number;
  email: string;
  role: string;
  color: string;
};

export type RoomState = {
  roomKey: string;
  modelName?: string;
  users: Map<string, OnlineUser>;
  socketIdByUserId: Map<string, string>;
};
