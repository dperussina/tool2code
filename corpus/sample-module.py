# KEY  r=read w=write d=destructive  >X=returns X  !X=call X first
#      ^X=superset of X  ?X=X is yours to supply, nothing here makes one
from typing import Literal

TrackingNumber = str  # {partnerId}U{orderId}, e.g., 999U123

def coding_task_execute(task:str,outputDir:str,inputFiles:list[dict]=None,options:dict=None):"w >task ID plus generated code, execution output, docs and metadata written to disk"
def coding_task_result(taskId:str):"r >finished task's full output: code, execution results, review, metadata, final state ^coding_task_status !coding_task_execute"
def coding_task_status(taskId:str):"r >current state/progress of the run, no artifacts !coding_task_execute"
def get_order_details(trackingNumber:TrackingNumber):"r >the whole ~40KB record: header, partner, freight, refs, notes, children, load, gallery, conversations, faxes, addresses, accessorials ^get_order_notes !quick_search_orders !register_order"
def get_order_notes(trackingNumber:TrackingNumber):"r >notes only !quick_search_orders !register_order"
def get_order_timeline(trackingNumber:TrackingNumber):"r >dated sequence of movements and status changes !quick_search_orders !register_order"
def get_order_tracking(trackingNumber:TrackingNumber):"r >EDI and scan events with timestamps, locations, status codes !quick_search_orders !register_order"
def get_place_details(placeId:str,language:str=None,fields:list[str]=None):"r >full profile of one place !search_places !nearby_search"
def nearby_search(location:dict,radius:float,type:str=None,keyword:str=None,language:str=None,minPrice:float=None,maxPrice:float=None,openNow:bool=None,rankBy:Literal["prominence","distance"]=None):"r >places within a radius of a point, ranked"
def quick_search_orders(query:str):"r >matching orders for an exact identifier or name, with tracking numbers"
def register_order(registrationType:Literal["1","2"],salesOrder:str,serviceLevel:Literal["2","3","4","5","6","7","8","9"],destinationName:str,destinationAddress:str,destinationCity:str,destinationState:str,destinationZipCode:str,destinationPhone:str,freightItems:list[dict],purchaseOrder:str=None,quoteId:str=None):"w >new tracking number, per-item label IDs, and quote"
def search_places(query:str,location:dict=None,radius:float=None,language:str=None,region:str=None,type:str=None):"r >places matching free text, with place IDs"
