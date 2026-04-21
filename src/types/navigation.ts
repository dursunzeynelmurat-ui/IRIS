export type RootStackParamList = {
  EventList: undefined;
  EventDetail: { eventId: string };
  Profile: undefined;
  Settings: undefined;
  SendSignal: { eventId?: string; eventTitle?: string } | undefined;
};
