import {useTranslation} from 'react-i18next';
import '@/lib/i18n/vehicleVisitWorkspace';
import {AlertDialog,AlertDialogAction,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogHeader,AlertDialogTitle} from '@/components/ui/alert-dialog';
export function ConfirmUnsavedVisitDialog({open,onOpenChange,onConfirm}:{open:boolean;onOpenChange:(v:boolean)=>void;onConfirm:()=>void}){
  const {t,i18n}=useTranslation();
  return <AlertDialog open={open} onOpenChange={onOpenChange}><AlertDialogContent dir={i18n.dir()}>
    <AlertDialogHeader><AlertDialogTitle>{t('vehicleVisitWorkspace.unsavedTitle')}</AlertDialogTitle><AlertDialogDescription>{t('vehicleVisitWorkspace.unsavedHint')}</AlertDialogDescription></AlertDialogHeader>
    <AlertDialogFooter><AlertDialogCancel>{t('vehicleVisitWorkspace.keepEditing')}</AlertDialogCancel><AlertDialogAction onClick={onConfirm}>{t('vehicleVisitWorkspace.leave')}</AlertDialogAction></AlertDialogFooter>
  </AlertDialogContent></AlertDialog>;
}
