"use client";

import { useState } from "react";
import { Button } from "~/components/ui/glass/button";
import { Input } from "~/components/ui/glass/input";
import { Label } from "~/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Plus } from "lucide-react";

export function AddDeviceDialog({
  onSave,
}: {
  onSave: (data: {
    macAddress: string;
    name: string;
    type: "headphone" | "source";
    notes?: string;
  }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [macAddress, setMacAddress] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<"headphone" | "source">("headphone");
  const [notes, setNotes] = useState("");

  const handleSave = () => {
    onSave({
      macAddress,
      name,
      type,
      notes: notes || undefined,
    });
    setMacAddress("");
    setName("");
    setType("headphone");
    setNotes("");
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button>
            <Plus className="mr-1 h-4 w-4" />
            Add Device
          </Button>
        }
      />
      <DialogContent className="glass-bg">
        <DialogHeader>
          <DialogTitle>Add Device</DialogTitle>
          <DialogDescription>
            Add a Bluetooth device to your saved devices list.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="mac">MAC Address</Label>
            <Input
              id="mac"
              placeholder="AA:BB:CC:DD:EE:FF"
              value={macAddress}
              onChange={(e) => setMacAddress(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="name">Device Name</Label>
            <Input
              id="name"
              placeholder="My Headphones"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Device Type</Label>
            <Select value={type} onValueChange={(v) => { if (v === "headphone" || v === "source") setType(v); }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="headphone">Headphone</SelectItem>
                <SelectItem value="source">Source (Phone/Laptop)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Input
              id="notes"
              placeholder="Optional notes..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!macAddress || !name}>
            Save Device
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
